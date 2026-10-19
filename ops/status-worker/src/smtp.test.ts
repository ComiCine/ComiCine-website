/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026 Limooo <https://limooo.cn/>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * SMTP delivery tests (tasks/22 W5-9).
 *
 * `sendViaSmtp` is the final step in the alert chain (webhook → Email → SMTP). Its 186
 * lines hand-build MIME and RFC 2045's 76-column folding, but previously had no tests.
 * Replace `cloudflare:sockets`'s `connect` with a scripted in-memory socket: the read side
 * supplies server replies and the write side records every client byte, so assertions
 * cover the **actual emitted protocol stream**.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "cloudflare:sockets";
import { sendViaSmtp, type SmtpConfig, type SmtpMessage } from "./smtp";

vi.mock("cloudflare:sockets", () => ({ connect: vi.fn() }));

const CRLF = "\r\n";

const CONFIG: SmtpConfig = {
  host: "smtp.example.com",
  port: 465,
  user: "alert@example.com",
  pass: "smtp-password",
  from: "alert@example.com",
};

/** Server replies; this covers multiline continuations (250-) and sequential 334 replies. */
const HAPPY_REPLIES = [
  "220 smtp.example.com ESMTP ready",
  "250-smtp.example.com greets you",
  "250-AUTH LOGIN PLAIN",
  "250 SIZE 10485760",
  "334 VXNlcm5hbWU6",
  "334 UGFzc3dvcmQ6",
  "235 2.7.0 accepted",
  "250 2.1.0 sender ok",
  "250 2.1.5 recipient ok",
  "354 end with <CRLF>.<CRLF>",
  "250 2.0.0 queued as ABC123",
].map((line) => line + CRLF);

interface Scripted {
  socket: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    opened: Promise<unknown>;
    close(): Promise<void>;
  };
  /** All client text writes concatenated in write order. */
  written: () => string;
}

function scriptedSocket(replies: string[] = HAPPY_REPLIES): Scripted {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      if (replies.length) controller.enqueue(encoder.encode(replies.join("")));
      controller.close();
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
    },
  });
  return {
    socket: { readable, writable, opened: Promise.resolve(), close: async () => undefined },
    written: () => buffer,
  };
}

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/** MIME header block, before the first blank line. */
function headerBlock(stream: string): string {
  const data = stream.slice(stream.indexOf("DATA" + CRLF) + ("DATA" + CRLF).length);
  return data.slice(0, data.indexOf(CRLF + CRLF));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sendViaSmtp", () => {
  it("never opens a socket when the config is incomplete", async () => {
    const message: SmtpMessage = { to: "ops@example.com", subject: "down", text: "x" };
    for (const broken of [
      { ...CONFIG, host: "" },
      { ...CONFIG, user: "" },
      { ...CONFIG, pass: "" },
      { ...CONFIG, from: "" },
    ]) {
      await expect(sendViaSmtp(broken, message)).resolves.toEqual({
        sent: false,
        reason: "smtp_config_incomplete",
      });
    }
    await expect(sendViaSmtp(CONFIG, { ...message, to: "" })).resolves.toEqual({
      sent: false,
      reason: "smtp_config_incomplete",
    });
    expect(vi.mocked(connect)).not.toHaveBeenCalled();
  });

  it("walks the full SMTP conversation in order and reports sent", async () => {
    const { socket, written } = scriptedSocket();
    vi.mocked(connect).mockReturnValue(socket as never);

    const result = await sendViaSmtp(CONFIG, {
      to: "ops@example.com",
      subject: "probe down",
      text: "Website is down",
    });

    expect(result).toEqual({ sent: true });
    expect(vi.mocked(connect)).toHaveBeenCalledWith(
      { hostname: "smtp.example.com", port: 465 },
      { secureTransport: "on" },
    );

    const stream = written();
    const order = [
      "EHLO limooo.cn",
      "AUTH LOGIN",
      base64(CONFIG.user),
      base64(CONFIG.pass),
      `MAIL FROM:<${CONFIG.from}>`,
      "RCPT TO:<ops@example.com>",
      "DATA",
    ].map((line) => stream.indexOf(line + CRLF));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(stream).toContain("QUIT" + CRLF);
  });

  it("encodes a non-ASCII subject as a UTF-8 B-word without leaking it raw", async () => {
    const { socket, written } = scriptedSocket();
    vi.mocked(connect).mockReturnValue(socket as never);
    const subject = "站点宕机 (・ω・)";

    await sendViaSmtp(CONFIG, { to: "ops@example.com", subject, text: "body" });

    const stream = written();
    const header = headerBlock(stream);
    const encoded = /Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/.exec(header);
    expect(encoded).not.toBeNull();
    expect(Buffer.from(encoded![1], "base64").toString("utf8")).toBe(subject);
    expect(header).not.toContain(subject);
  });

  it("strips CR/LF out of header values so they cannot inject headers", async () => {
    const { socket, written } = scriptedSocket();
    vi.mocked(connect).mockReturnValue(socket as never);

    await sendViaSmtp(CONFIG, {
      to: "ops@example.com\r\nBcc: attacker@example.com",
      subject: "down\r\nX-Injected: 1",
      text: "body",
    });

    const header = headerBlock(written());
    expect(header).not.toContain(CRLF + "Bcc:");
    expect(header).not.toContain(CRLF + "X-Injected:");
    expect(header).toContain("To: ops@example.com Bcc: attacker@example.com");
    expect(header).toContain("Subject: =?UTF-8?B?");
    // The headers must not contain an unencoded injection payload (no raw CRLF outside
    // the B-word encoding).
    expect(header.split(CRLF).every((line) => !line.startsWith("Bcc:"))).toBe(true);
  });

  it("wraps base64 payloads at 76 columns and round-trips the text", async () => {
    const { socket, written } = scriptedSocket();
    vi.mocked(connect).mockReturnValue(socket as never);
    const text = "Limooo probe down. ".repeat(40);

    await sendViaSmtp(CONFIG, { to: "ops@example.com", subject: "down", text });

    const stream = written();
    const data = stream.slice(stream.indexOf("DATA" + CRLF) + 6);
    const body = data.slice(data.indexOf(CRLF + CRLF) + 4).replace(/\r\n\.\r\n[\s\S]*$/, "");
    const lines = body.split(CRLF).filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(0, -1).every((line) => line.length === 76)).toBe(true);
    expect(lines[lines.length - 1]!.length).toBeLessThanOrEqual(76);
    expect(Buffer.from(lines.join(""), "base64").toString("utf8")).toBe(text);
  });

  it("terminates DATA exactly once so no body line can end the message early", async () => {
    const { socket, written } = scriptedSocket();
    vi.mocked(connect).mockReturnValue(socket as never);

    await sendViaSmtp(CONFIG, { to: "ops@example.com", subject: "d", text: ".\n..\n." });

    const stream = written();
    const terminators = stream.split(CRLF + "." + CRLF).length - 1;
    expect(terminators).toBe(1);
    expect(stream.indexOf(CRLF + "." + CRLF)).toBeLessThan(stream.indexOf("QUIT" + CRLF));
  });

  it("builds a multipart/alternative body when html is provided", async () => {
    const { socket, written } = scriptedSocket();
    vi.mocked(connect).mockReturnValue(socket as never);

    await sendViaSmtp(CONFIG, {
      to: "ops@example.com",
      subject: "down",
      text: "plain body",
      html: "<p>html body</p>",
    });

    const stream = written();
    const boundary = /boundary="(limooo-[0-9a-f]+)"/.exec(stream);
    expect(boundary).not.toBeNull();
    expect(stream).toContain(`--${boundary![1]}${CRLF}Content-Type: text/plain`);
    expect(stream).toContain(`--${boundary![1]}${CRLF}Content-Type: text/html`);
    expect(stream).toContain(`--${boundary![1]}--`);
    // Both part bodies are base64; decoding them must reproduce the original text.
    const parts = [...stream.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)].map(
      (match) => Buffer.from(match[1].replace(/\r\n/g, ""), "base64").toString("utf8"),
    );
    expect(parts).toEqual(["plain body", "<p>html body</p>"]);
  });

  it("reports a bad greeting instead of throwing", async () => {
    const { socket } = scriptedSocket(["554 service unavailable" + CRLF]);
    vi.mocked(connect).mockReturnValue(socket as never);

    const result = await sendViaSmtp(CONFIG, { to: "ops@example.com", subject: "s", text: "t" });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("smtp_greeting");
    expect(result.reason).toContain("554");
  });

  it("reports an unexpected reply instead of throwing", async () => {
    const replies = [...HAPPY_REPLIES];
    replies[6] = "535 authentication failed" + CRLF;
    const { socket } = scriptedSocket(replies);
    vi.mocked(connect).mockReturnValue(socket as never);

    const result = await sendViaSmtp(CONFIG, { to: "ops@example.com", subject: "s", text: "t" });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("smtp_unexpected");
    expect(result.reason!.length).toBeLessThanOrEqual(160);
  });

  it("reports a socket failure instead of throwing", async () => {
    vi.mocked(connect).mockImplementation(() => {
      throw new Error("connect refused");
    });

    const result = await sendViaSmtp(CONFIG, { to: "ops@example.com", subject: "s", text: "t" });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("smtp_error");
    expect(result.reason).toContain("connect refused");
  });

  it("gives up when the server closes the connection mid-conversation", async () => {
    const { socket } = scriptedSocket(["220 ready" + CRLF]);
    vi.mocked(connect).mockReturnValue(socket as never);

    const result = await sendViaSmtp(CONFIG, { to: "ops@example.com", subject: "s", text: "t" });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("smtp_closed");
  });

  it("times out when the SMTP server leaves a read pending", async () => {
    vi.useFakeTimers();
    const socket = {
      readable: new ReadableStream<Uint8Array>({}),
      writable: new WritableStream<Uint8Array>(),
      opened: Promise.resolve(),
      close: vi.fn(async () => undefined),
    };
    vi.mocked(connect).mockReturnValue(socket as never);

    const pending = sendViaSmtp(CONFIG, { to: "ops@example.com", subject: "s", text: "t" });
    await vi.advanceTimersByTimeAsync(15_001);
    const result = await pending;

    expect(result.sent).toBe(false);
    expect(result.reason).toContain("smtp_timeout");
    expect(socket.close).toHaveBeenCalled();
  });
});
