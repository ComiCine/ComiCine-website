---
title: "MU5735 / DCA22WA102 Evidence Summary Report"
description: "Analysis of MU5735 accident data from NTSB FOIA recorder reports, FDR, ARINC 717, and ACARS materials, distinguishing supported facts, inferences, and unresolved questions."
outline: [2, 3]
aliases: [MU5735 Report, DCA22WA102 Report]
date: 2026-11-08
version: 2.2
tags: [MU5735, DCA22WA102, aviation accident, FDR, CVR]
---

# MU5735 / DCA22WA102 Evidence Summary Report

::: tip Reading navigation

Quick reading: §0 Summary → §2 Timeline → §4 FDR event → §5 ARINC 717 decoding → §6 Radar, physics, and impact → §9 Conflicts → §10 Limits and conclusions. Technical detail is in §§4–7; investigation history is in §8. The page outline provides the complete section list.

:::

---

## 0. Summary

On 2022-03-21, China Eastern Airlines flight MU5735 (B-737-800, B-1791, Kunming ZPPP → Guangzhou ZGGG) crashed in Wuzhou, Guangxi. All 123 passengers and 9 crew members on board were killed. The CAAC led the investigation under Annex 13, with NTSB assistance. Four years after the accident, in April 2026, the NTSB released 1,959 pages of records, two FDR tables, and three FDR raw files under 49 U.S.C. §1114(f).

::: info The sequence in one minute

Cruise at 29,103 ft → both engine fuel control switch parameters changed to CUTOFF → about 1.8 s later the control wheel was moved to −28°, then repeatedly deflected left and relaxed; the aircraft continued rolling left → about 1.45 revolutions of left roll and a −36° dive → the FDR stopped at 25,389 ft after generator dropout → radar recorded a descent rate of 21,600 ft/min → last radar point at 06:21:40; impact at about 06:22:30. The cockpit voice recorder (CVR) should contain the final approximately 70–97 seconds, but it is held by the Chinese side.

:::

**What the materials support:**

1. At 29,103 ft in cruise, **the fuel control switch parameters for both engines changed from RUN to CUTOFF within the same one-second sampling window**. N2 then declined monotonically from 92.4% to 49.9% (Eng 1) / 52.5% (Eng 2); N1 from 83.5% to 25.6% / 25.8%; EGT from 623°C to 395 / 397°C; and fuel flow reached 0. **Throttle lever angle remained between 58.9° and 60.1° throughout; there was no throttle movement.**
2. The first valid control-input sample appears about 1.8 s after cutoff: **control wheel −28.1°**. It then varied repeatedly between −19° and −102°, with a peak of −101.95° and a median of about −47°. The ailerons followed proportionally, reaching about +17.8° / −18.4° at full deflection. **The aircraft continued rolling in the same leftward direction, accumulating about −528° to −540° over 16.3 s (≈1.45–1.50 revolutions; ), at an average −32 ± 2°/s; pitch attitude changed from +2.46° to −35.86°; IAS from 265 to 339.75 kt; altitude from 29,103 to 25,389 ft.**
3. **The aircraft systems were operating at the time**: hydraulic pressure A 2,960–3,004 / B 2,972–3,016 psi; the ailerons, elevators, control wheel, and control column all moved with the inputs; both engine fire-warning indications were NO FIRE in valid data; both engines decayed in sync, with neither failing first.
4. **The FDR stopped at about 25,389 ft after generator dropout**; the inferred N2 dropout threshold is about 49% (48.6–49.9%, **inference**), at about 06:21:06–07Z. The last measured radar point at 06:21:40Z was 3,380 m, showing that the aircraft descended another approximately 4,300 m after recording stopped.
5. **All four CVR channels were rated Excellent** (about 120 min on each of the three audio panels and about 180 min on CAM). The NTSB received the recorder and downloaded it, then returned all audio to the CAAC and retained none. The FOIA response explicitly says the NTSB holds no CVR data. **Therefore, this release contains no audio and no transcript.**
6. **As of the April 2026 release, no final report had been made public.** Volume 8 emails show that the NTSB was still asking for a report schedule on 2024-03-21, and the CAAC gave none. The only explicit statement in that letter was “since a final report has yet to be issued.” The CAAC’s 2024-03-20 second-anniversary statement said that “no faults or abnormalities were found in the aircraft systems, airframe structure, engines, etc. before takeoff,” but gave neither a cause determination nor a report schedule.

::: warning Evidence boundary

The materials do not establish who moved the controls, why, or whether the actions were “intentional.” The FDR can establish that the fuel-switch position parameters changed and that the aircraft was controlled in this manner; it cannot distinguish intent from incapacitation, a struggle, or a common-mode mechanical/electrical fault. The CVR is critical, and it is in the custody of the CAAC. The CAAC is the authority responsible for determining the cause.

:::

---

## 1. Materials and integrity

### 1.1 NTSB FOIA response (DCA22WA102)

| Item | Count |
|---|---:|
| Responsive records located | **2,818 pages** |
| Actually released | **1,959 pages + 2 tables + 3 FDR files = 13 files** |
| Fully withheld under b(4), trade secrets | 26 pages |
| Fully withheld / partially redacted under b(5), deliberative process | 478 / **122 pages (response ledger)** |
| Fully withheld / partially redacted under b(6), personal privacy | 355 / **192 pages (response ledger)** |
| Total fully withheld | **859 pages (30.5%)** |
| Total partially redacted | **314 pages (response ledger)** |
| Release rate | 1,959 / 2,818 = **69.5%** |

**Physical cross-check**: In the released records, b(5) text labels appear on 75 pages, b(6) on 119, and either label on 124; four pages are marked Referred (vol. 8 pp. 37/38/39/112); b(4) appears on 0 pages. Pixel-based black-box counting found **192 pages** with any solid black area (180 in vol. 8 + 12 in vol. 1; 163 with >0.5% coverage), still below the ledger total of 314. **The 190-page discrepancy cannot be explained solely by “photographic black boxes without text labels.”** The more likely explanation is that the ledger also counts pages withheld in full or deleted against a white background. The released records establish only that 124 pages carry text labels and 192 have black boxes. **Do not state that “314 pages have been verified”**.

Key points in the response: the NTSB does not hold CVR data; FDR data require specialized software and proprietary manufacturer documentation; some pages originated with the FAA and are marked “Referred.”

### 1.2 OCR and derived data

The released scans were image-only (1275×1650 JPEG, 150 dpi, no text layer) and were fully OCR'd. Another **300-dpi OCR pass plus visual review of cropped key values across 47 items** was done for 52 critical pages (vol. 1 pp. 1–33 and vol. 8 pp. 157–175): none of the numbers, part numbers, times, or weights was overturned (CVR/FDR P/Ns, 120/120/120/180 min, 6.5+1.3 s, 26,000 ft, TOW 66,039, PAX 123, crew hours, radar 3,380 m / 1,010 km/h / 117.8°). The 300-dpi pass corrected only letter-level readings such as audio-file-format labels (13 instances), and introduced 12 new f→t misreads; therefore the main text follows the 144-dpi OCR, while readings of audio-file-format labels follow the 300-dpi pass. `CABINE` / `EXRA` / `PLANED` in the PowerPoint are source typos, not OCR errors. Neither OCR version of the embossed markings on photographs, chip markings, nor the axes on the plots on pp. 25–27 is reliable; do not cite them. Both FDR data tables were audited column by column; all three ARINC 717 data segments were decoded.

---

## 2. Timeline (absolute times with ranges)

### 2.1 Time bases

- CAAC/ATC times are Beijing time (UTC+8); ACARS times are UTC; FOIA emails use Eastern Daylight Time (EDT, UTC−4).
- FDR `Time (sec)` is the recorder's internal counter (288,200–288,978 s), not clock time; it was back-calculated using the “end of recording + radar.”
- **The ARINC 717 data-block length is determined to be 1.000 s/block** (the U2 gap recurs every 8 blocks = 8 s in the NTSB data; full-segment altitude fit B=1.0, while B=1.0195 has RMS 12,980 ft). The previous-flight ARINC 717 data are an exception: their time base was stretched by 1.385×, so they cannot be used for absolute synchronization.

### 2.2 Main timeline (key intervals)

| Beijing time | UTC | Event | Basis |
|---|---|---|---|
| 12:54 | 04:54 | Crew first contacts Kunming ATC | vol. 8 p. 174 |
| 13:15 | 05:15 | Kunming Tower issues takeoff clearance | vol. 8 p. 174 |
| **13:16:26** (13:15:53–13:16:50) | **05:16:26** | **Liftoff**; ACARS TKO message at 05:16:00Z | ACARS + FDR + CAAC |
| 13:27:26 | 05:27:26 | Reaches and maintains 8,900 m (29,199 ft); FDR reads 29,228 ft (including −125.6 ft offset) | CAAC + ARINC 717 data |
| 13:35 | 05:35 | ATC instructs a 5-nm offset; during the same minute the FDR shows a −27° left-bank maneuver (direction inconsistent with “right”) | vol. 8 p. 171; ARINC 717 data |
| 14:16 / 14:17 | 06:16 / 06:17 | Contacts Guangzhou Area Control / enters Guangzhou control area | vol. 8 pp. 171/174 |
| **14:20:48** (14:20:45–14:20:50) | **06:20:48** | **Both engine fuel control switch parameters change from RUN to CUTOFF**; 29,103 ft; first radar row is 8,870 m | FDR + radar |
| 14:20:55 | 06:20:55 | Radar **CL warning** (Deviation from Cleared Level) | SSR table |
| 14:21:05 (14:21:04–14:21:07) | 06:21:05 | **FDR stops recording**: 25,389 ft / 339.75 kt / N1 25.6% | FDR + radar |
| **14:21:40** | **06:21:40** | **Last measured secondary-surveillance radar point**: 3,380 m, 1,010 km/h, 117.8° | CAAC + SSR table |
| **≈14:22:30** (14:22:15–14:22:42) | **≈06:22:30** | **Impact** (extrapolated; position ±5 km, time ±10–18 s); **point cited from outside the release**: 23°19′25.52″N 111°06′44.30″E (preliminary-report text is not in the release; the package establishes only that the preliminary report existed) | Radar + physical/geometric reconstruction |
| 14:22:14–40 | 06:22:14–40 | Eyewitness observation window (38 interviewees; CAAC's own note says “statements are in conflict”) | vol. 8 p. 172 |
| 14:30 | 06:30 | CAAC notification form says “about 06:30”; copied on the NTSB cover | vol. 8 p. 92; vol. 1 p. 3 |

**06:30 is not the impact time**: it is 7–9 minutes later than the radar point at 06:21:40, the FDR stop at 06:21:05, and the eyewitness window at 06:22:14–40. It is a rounded time used on the notification form / in reporting.

### 2.3 Three timeline conventions

| Quantity | Value | Explanation |
|---|---|---|
| CUTOFF | 06:20:45–50Z | Best radar-altitude fit is 06:20:48; FDR counter 288,958.586 |
| FDR stop | 06:21:04–07Z | Strict anchor 06:21:06.98; timeline value 06:21:05; radar interpolation 06:21:04.1 |
| Impact | 06:22:15–42Z, center 06:22:30 | Pure vertical extrapolation gives 06:22:12–19, but the landing point is 8.6 km from the point cited from outside the release; use the external point |
| Liftoff | 13:16:26 (13:15:53–13:16:50) | ACARS whole-minute time + ARINC 717 data: 64.37 min (liftoff→CUTOFF) / 64.85 min (→FDR stop) + CAAC 13:16 |

![Main accident-day timeline, BJT/UTC dual scale, 12:54–14:23](/assets/articles_mu5735_fig01_timeline.png)

*Figure 1: Main accident-day timeline (BJT/UTC dual scale, 12:54–14:23).*

---

## 3. NTSB Cockpit Voice and Flight Data Recorder Combined Download Report (33 pages, 2022-07-01)

### 3.1 CVR (Cockpit Voice Recorder; Honeywell HFR5-V, P/N 980-6032-001, S/N CVR-04014)

- Found on March 23, with severe impact damage; the Chinese team repeatedly failed to download it in Beijing using a replacement chassis.
- The NTSB received CVR data on March 28. Playback32 extracted four audio tracks, but they were **unintelligible / unusable** (p. 5).
- Microscopic examination: connector solder pads broken, pins deformed, and ground plane fractured; more pins were found pressed down after the case was opened; one power-filter capacitor had already been unsoldered at manufacture.
- After connector repair, a DLDR chip image plus Playback32 produced **Fair** audio on the three audio panels and **Poor** on CAM (p. 10).
- The unit was opened, fitted with a new connector shell, connected to an NTSB HFR5-V golden chassis, and downloaded again; **all four channels were rated Excellent** (p. 13): about 120 min per panel and about 180 min on CAM.
- Remaining issue: nonlinear time drift between CAM and the crew channels; random packet loss on narrowband channels.
- **All audio, raw files, and intermediate files were returned to the CAAC; the NTSB retained photographs, scans, and microscopic images only, not audio.**

### 3.2 FDR (Flight Data Recorder; Honeywell HFR5-D, P/N 980-4750-009, S/N FDR-02952)

- 512 12-bit words per second; 512-word block = 1 second = one subframe; sync words distinguish subframes 1–4.
- Received April 4; conventional download failed and the image was all zeros. A crack in flash chip U2 ran from the package edge to the center of the die. The six data chips U1–U6 were removed and read directly; **U2 was unreadable**, while the other five were successful.
- A dummy all-FF file replaced U2 to generate a DLU; the accident segment was in the middle of the data stream and was manually rearranged to the end.
- Data were striped across the chips, about 1.3 s per chip → **6.5 s valid + 1.3 s gap**. The software incorrectly inserted four samples for every eight subframes, creating about 4 s of false gaps; alignment was manually corrected at each boundary.
- **Only the final 12 minutes were made into a time-accurate version**; the previous flight's landing/taxi portion was corrected.
- About 150 of more than 1,000 parameters were validated; Appendix B of the NTSB report lists 153 parameters.
- Recording ended at about 26,000 ft (actual last valid sample: 25,389 ft). Cause: both engines' N2 fell below generator dropout speed; the FDR has no battery. The CVR has a battery and could record for at least another 10 minutes.
- **The only passage about the accident sequence (p. 23)**: during cruise at 29,000 ft, the fuel control switches for both engines moved from RUN to CUTOFF, after which engine speeds decreased.

### 3.3 Scope of the report

The report covers recorder repair, readout, and transfer only; it contains no analysis or conclusions. The signature is on p. 24, pp. 25–27 are FDR plots, and pp. 28–33 are appendices. **It is not an accident investigation report.**

---

## 4. FDR event (final approximately 19 seconds)

> T=0 is `Time=288958.5859` (both engine Cutoff SW parameters show CUTOFF simultaneously). T is recorder-counter seconds; the last valid sample is T+18.75 (25,389 ft / 339.75 kt), and the last raw sample is T+18.95.
> Values in the table come from original FDR sample data (preferred for discrete parameters) and the 1/16-second FDR summary grid; roll is wrapped at ±180°, with unwrapped values noted separately.

### 4.1 Event table

| T | Altitude ft | IAS kt | Pitch ° | Roll ° | Control wheel ° | Aileron L/R ° | N1 E1/E2% | N2 E1/E2% | EGT °C | FF pph |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| 0.00 | 29,103 | 265.0 | 2.46 | 0.2 | 3.5 | −2.5/4.0 | 83.5/83.5 | 92.4/92.4 | 623 | 2,608 |
| 1.82 | — | — | — | — | **−28.1** | **+3.3/−2.0** | — | — | — | — |
| 2.04 | — | — | — | — | — | — | — | — | — | — |
| 2.22 | — | — | — | — | — | — | — | — | — | — |
| 3.00 | 29,075 | 263.2 | 1.93 | −10.7 | −81.6 | 14.9/−14.6 | 48.2/52.8 | 76.4/78.5 | 512 | 304 |
| 4.00 | 29,066 | 262.5 | 1.05 | −36.7 | −80.5 | 14.0/−13.4 | 41.4/44.0 | 73.5/75.4 | 494 | 368 |
| 5.00 | 29,048 | 261.8 | −2.11 | −68.9 | −58.0 | 11.6/−10.6 | 36.8/38.8 | 70.9/72.6 | 482 | 432 |
| 6.00 | 29,013 | 262.2 | −6.50 | −105.5 | −67.8 | 14.2/−13.2 | 33.6/35.1 | 68.6/70.2 | 476 | 496 |
| 8.00 | 28,822 | 265.5 | −14.06 | −169.6 | −30.6 | 5.5/−4.4 | 29.9/30.8 | 64.5/66.0 | 470 | 640 |
| 10.00 | 28,746 | 272.0 | −21.45 | +143.4 | −98.8 | 17.6/−18.6 | 29.9/29.4 | 61.1/64.1 | 470 | 640 |
| 12.00 | 27,935 | 284.0 | −23.91 | +59.2 | −57.3 | 10.9/−10.2 | 26.5/27.0 | 57.9/59.2 | 449 | 1,056 |
| 14.00 | 27,268 | 301.8 | −26.37 | 0.2 | −99.8 | 17.1/−18.1 | 26.0/26.2 | 55.1/56.5 | 421 | 0 |
| 16.00 | 26,587 | 319.0 | −29.36 | −82.1 | −67.5 | 11.4/−10.9 | 25.6/26.0 | 52.4/53.8 | 410 | 0 |
| 18.00 | 26,403 | 321.0 | −34.98 | −152.6 | −19.3 | 2.4/−1.3 | 25.6/25.8 | 49.9/52.5 | 410 | 0 |
| **18.75** | **25,389** | **339.75** | **−35.86** | **−167.9** (unwrapped −527.9) | −47.5 | — | **25.6/25.8** | **49.9/52.5** | 395 | 0 |

**Key anchors:**

- **T+1.82**: first valid control-input sample (control wheel −28.13, ailerons +3.31/−1.99, roll rate −2.5°/s).
- **T+1.85**: AP-1/AP-2 disconnect warnings; **T+2.04** A/T disconnect; **T+2.22** AP → F/D Only (CMD A Not SELECTED).
- **T+0.3–1.8**: U2 gap of about 1.4 s.
- **T+18.75**: last valid sample; **T+18.95**: recording terminates.

![Six-panel view of the final 60 seconds: altitude, IAS, roll, control wheel, N1, and N2](/assets/articles_mu5735_fig02_last60s.png)

*Figure 2: Six-panel view of the final 60 seconds (altitude/IAS/roll/control wheel/N1/N2).*

Note: the unwrapped final roll value at T+18.75 is −527.9°; integration over the full 8-Hz window gives −540.4°. The main text's −528 to −540° range in §§4.3/6.2 rounds the lower bound from −527.9 (a 0.1° difference) and uses the 8-Hz integration for the upper bound;  (B=1.0195) and is not used. **The table's +143.4/+59.2 are wrapped values at ±180°; unwrapped they are −216.6/−300.8 (continuing left roll), not right roll.**

### 4.2 Engines

- N1 83.5 → 25.6/25.8%; N2 92.4 → 49.9/52.5%; EGT 623 → 395/397°C; single-engine FF 2,608 → 0 (with a nonphysical intermediate rebound from 304 to 1,056, a reconstruction artifact that must not be treated as actual fuel flow).
- **TRA stayed at 58.9–60.1° throughout**—the throttle levers were not retarded; shutdown resulted from the fuel control switches.
- Both engines decayed in sync, with neither failing first; there was no fire in valid data (the only FIRE indication is in the final saturated bad frame).

### 4.3 Controls and attitude

- Control wheel: +3.5° → first valid sample −28.1° → peak **−101.95°**; event-segment **median about −47°**. Only **18%** of samples were ≤ −90°; the wheel repeatedly moved between −19° and −102°, so this was **not “held at full left.”**
- Ailerons followed proportionally, reaching about +17.8°/−18.4° at full deflection; elevator −4.5 → −7.7°, control column 0.2 → −5.0°, control force about −0.95 to +0.71 lb (sign convention not supplied, so pull/push cannot be determined).
- Roll: continued in the same leftward direction, accumulating **about −528° to −540° over 16.3 s (≈1.45–1.50 revolutions; )**, average **−32 ± 2°/s**; pitch attitude +2.46 → −35.86°; Nz **about −0.29…+1.29 g** (88% of samples < 1 g).
- **The rudder channel cannot establish that the rudder was functioning normally**: 5,052 of 5,133 samples are frozen at −1.0°; −54° appears only in the final bad frame. Use Rudder Ped Pos instead (−0.99…0.00°; 11.42° is a full-scale bad frame at 288977.449) and Rudder Servo Cmd (±2°).
- Hydraulic pressure A 2,960–3,004 / B 2,972–3,016 psi; no fire warning; no thrust asymmetry.

### 4.4 Data quality

- **165 columns = 1 time + 101 numeric + 63 status/text**. Status columns (AP/AT, fire warning, fuel control switches, electrical power, hydraulic pumps) appear as **text enumerations** in the FDR summary grid (e.g., Eng1 Cutoff SW has 775 nonblank samples and AP Off has 1,550); they are not all blank. Numeric analysis must use the original-sample FDR data, and use those data first when determining discrete states (gaps in the summary grid are filled as CUTOFF/FIRE/F-D Only).
- **38,548/231,885 = 16.6% of values in the 101 numeric parameters of the FDR summary grid are fill codes** (−1, 1023, 16368, 4092, 127.88, 511.75, 65520, 5.9996, 179.8, etc.); the original-sample data are essentially clean.
- Quality: 136 good + 7 usable = 143 columns directly usable; 17 degraded/partial; 5 unusable (three radio altimeters, Selected Airspeed FCC, Selected Mach FCC).
- **Three full-second gaps**: rel 31.9375, 703.9375, 719.9375, each 1.000 s, with zero samples for all 164 parameters in that second; the summary grid skips 16 rows without interpolation, and the surrounding values are continuous → **one full second dropped from the FDR**, not a reconstruction artifact; this occurred in cruise and is unrelated to the accident.
- There are also inherent U2 stripe gaps of **about 1.3 s every 8 s**; these are separate from the three full-second gaps.
- **Two bad frames in the final second**: zeroed frame at 288976.63–.86 (13 analog values) and full-scale frame at 288977.40–.54 (33 analog values, including Rudder −54, TRA 143.6, N2 102.125, Accel 4.11 g). **Reconstruction should stop at 288977.38 s.**
- **0.31–0.55 s of valid data remain after the 28VDC BAT BUS/STDBY BUS OFF at 776.791 s** (altitude 777.338, IAS 777.334, N1 777.213, EGT 777.113, hydraulics 777.100, DC BUS 1 777.172 ON, HOT BAT 777.174 ON); classify it as a bad frame; if real, it was a battery-bus transient. An N2 threshold of 45% would be 2.85 s later / about 24,401 ft; 55% would be 5.15 s earlier / about 27,175 ft. If the FDR had switched to battery backup, it should have recorded at least 10 more minutes; it did not, which argues against battery-backup power.
- The two FDR data representations differ systematically: the summary grid fills gaps with −1.0 ft / 511.75 kt / 127.875 / 4092 psi / CUTOFF / FIRE / F/D Only. **Use the original-sample data first for discrete states.** AP Off flips between On and F/D Only every second and cannot determine the disconnect time (use the AP-1/AP-2 warnings or CMD A).
- False CUTOFFs: of 130 CUTOFF entries per engine in the summary grid, **110 (84.6%) are U2-gap fills** (t mod 8 = 7.5625/0.5625); among the 20 per engine in the accident block, the original-sample data support 16. False FIRE appears 213 times, false APU ON 175 times, and false flaps 40° 98 times; all come from the 8-second U2 gap cycle.

---

**Closed loop**: The FDR stopped at 25,389 ft after both engines' N2 fell below generator dropout speed (the FDR has no battery); radar continued to record the aircraft down to 3,380 m at 06:21:40, showing a further descent of about 4,300 m after recording stopped; impact was about 06:22:30 (see §6).

## 5. ARINC 717 decoding and two-flight profiles

### 5.1 Decoding method and calibration

- ARINC 717: 512 12-bit words per second; 512-word block = 1 s; sync words 0x247/0x5B8/0xA47/0xDB8 cycle every four seconds; 0xFFF is invalid.
- **Block structure = 16 minor frames × 32 words**; each parameter is fixed at a set of minor-frame phases, leaving only one unknown slot k (0–31).
- Time alignment: **T0 = 43.000 s** (block i ↔ 288,243.0+i; add mf/16 s for the minor frame and k/512 s for each word). **Aligning to NTSB row number `640+16i` without accounting for three one-second gaps creates a 3-s drift; the cross-check supports T0=43.000 s.** The 8-Hz cross-check used pointwise residuals: at T0=43.0, Roll/Pitch residual p90 falls from 0.178° to 0.003° (a quantization step). Block length is **1.000 s** (U2 gap every 8 blocks = 8 s; rejected B=1.0195 because its full-segment altitude RMS is 12,980 ft).
- Altitude: The calibrated scale is **31.807 ft/count**; the earlier formula `raw×32.08+99` is systematically 126.6 ft high (physics fit 125.6 ft; 1-ft difference is the fit window); calibrated cruise altitude is 29,102 ft = FL291, and final altitude is 25,389 ft, matching radar 8,870 m at 06:20:50 within 0.3 ft. The 32-ft quantization is a hard limit; do not treat differences <32 ft as real.
- Verified: IAS median difference 0.00 kt, EGT 0, N1 0, **N2 bit-exact**; roll/pitch/wheel p95 <2°; decoded channel-slot and timestamp inversion agree **31/31** (median per-sample timestamp grid residual 1.9e-5 s).
- **The final decode has 32 channels**, including Roll_Rate, Accel_Lat/Long, Eng2_EGT/FF/N1, and HydB; 31 are decoded, while Flap remains unresolved. Aileron scales **17.309/17.539**, rudder **17.844**; elevator/control column are essentially unchanged. Median residuals: ailerons **0.0138/0.0117°** (176×/245× better than the earlier calibration), elevator 0.00065/0.00106° (3.3×), control column 0.00152/0.00581° (5.3×), rudder 0.0282° (3×), roll rate 0.0093°/s.
- **Accel Lat/Long are decoded**: scale 1964.4/1964.6 counts/g, residual 5e-5/3e-4 g (export precision), medium confidence (±5%). Still unresolved: Oil Press/Temp, Flap (8-s square-wave artifact); Stab Trim is not among the 165 columns. An independently supported absolute-time alignment was not established for the previous-flight ARINC 717 data because there is no independent evidence for block-to-absolute-time alignment.
- **Independent cross-check**: **31/31 channels reproduced**; aileron scales 17.309/17.539 hold; rudder scale 17.844 may be 10–15% low (quantization-level back-calculation suggests about 15.4); altitude-change quantization median 32.5 ft (not 2.1 ft as in cruise); the negative-time segment of the combined two-flight ARINC 717 data has 7 all-zero blocks / 3 damaged blocks, not affecting the accident segment (735/735 blocks match the accident-flight data); the sign of the Elevator_R calibration offset in the parameter mapping was corrected.
- **8-Hz check**: control wheel P2P **105.5°** (never right wheel, only left input and relaxation); aileron L/R P2P **19.8/21.8°**; roll-rate P2P **48.8°/s** (slot 9/odd, raw/15.992, residual 0.0093); control column 8.7°, elevator 7.7°, rudder 3.1°.
- Input pattern was **repeated near-full left input followed by relaxation**: 719/725–726/729–730 deflected to −99…−102°; 723/728 relaxed to −26…−9°; primary frequency about 0.09–0.10 Hz, with another ~19% of the energy at 0.7–1.5 Hz from rapid corrections. Wheel-to-aileron lag 46 ms (r=−0.993), aileron-to-roll-rate lag 0.56 s (r=−0.972), roll angle lags roll rate by 89.2° (integrator).

### 5.2 Accident flight

| Phase | Duration | Data |
|---|---|---|
| Ground/taxi/hold | 13.75 min | 6,900 ft, N1 21–36%, EGT 118–572°C |
| Takeoff roll | 0.87 min | N1 28→100.4%, IAS 45→167 |
| Climb | 11.32 min | 6,900→29,228 ft (calibrated 29,102), average 2,033 ft/min, N1 95–100%, EGT 786–875°C |
| Cruise FL291 | 53.27 min | 29,228 ft (calibrated 29,102), N1 84.1% (drift −0.027/min), IAS 267.8, EGT 629.2, FF 2,656 pph per engine, Mach 0.700 (FMC target) |
| Upset/dive | 0.28 min | CUTOFF → left roll −528 to −540° → pitch −35.86°; FDR stops |

- Cruise altitude has only one quantization code (29,227.6 ft); the apparent “variation” is 128.32-ft quantization noise. Actual Mach changes from 0.69 to 0.81 (`FMC_Mach` is the target, not measured Mach).
- No step change or single-engine pattern (the decode includes Eng2 N1/N2/EGT/FF; both engines were symmetrical).

### 5.3 Previous flight (MU5864, Chongqing ZUC → Kunming ZPP)

| Phase | Duration | Data |
|---|---|---|
| Taxi out | 2.30 min | 1,382 ft (Chongqing), N1 21% |
| Takeoff roll | 0.82 min | N1 21→88.4%, IAS 45→158 |
| Climb | 10.87 min | 1,382→25,709 ft (peak 25,763), 2,347 ft/min, N1 88–99.6% |
| Cruise FL258 | 35.07 min | 25,709 ft, N1 83.7%, IAS 295, EGT 632.3 |
| Descent/steps/approach | 6.28+2.20+10.00+3.33+4.72 min | Descent −980/−956 ft/min, final approach −811 ft/min, IAS 150–165 |
| Landing/taxi in | 0.57+5.15 min | IAS 151→45 kt / 35 s (−3.11 kt/s), peak reverse-thrust N1 76.3% |

- **Important limitation**: the combined previous-flight / accident-flight ARINC 717 data are joined at block 4877 (previous flight shutdown / accident-flight start), **so the Kunming turnaround is truncated**; only an upper bound can be given for the previous flight's absolute time.
- Anchoring on ACARS MU5864 TKO at 02:11Z (10:11 Beijing) and ARINC 717 data duration of 72.45 min from liftoff to landing gives **landing at about 11:24 Beijing (11:2x–11:3x)**, corresponding to Δ≈1.9 h (11:24 landing → 13:16 takeoff = 1 h 52 min). Do not use 12:55:39 based on a false continuity assumption or 12:30 inferred from a “25-min turnaround.”
- The accident flight is entirely after the join point; its timeline is unaffected.

![Altitude, IAS, and N1 profiles for both flights](/assets/articles_mu5735_fig04_two_flights.png)

*Figure 3: Altitude/IAS/N1 profiles for both flights (join at block 4,877).*

### 5.4 Data gaps and artifacts

- U2 data loss is about 20%: 7.97-s cycle = 6.4 s valid + 1.6 s gap.
- Altitude quantization is 128.32 ft; ground IAS is stuck at 45 kt and Mach at 1.25; Flap is unusable (8-s square-wave artifact); FMV is usable in the original-sample FDR data (34.0→2.0/1.75), but the ARINC 717-decoded FMV column is unreliable; garbage blocks near the join point (altitude 35,066 ft, EGT 1,004°C).
- Heading 355°→0° is a continuous turn through north, not an anomaly; the ±27° cruise bank is a real maneuver; N1 swings of 35–86% on approach are real thrust oscillations.
- **The +40°/−23° track swing from 06:21:25–35 is a radar-degradation artifact**, not a real turn (would require 3.3 g / 73° bank, while actual Nz was 0.9 g; position-difference speed M1.06–1.14).

---

## 6. Radar, physics, and impact

### 6.1 Radar descent

| UTC | Altitude m | Ground speed km/h | Track ° | Note |
|---|---:|---:|---:|---|
| 06:20:50 | 8,870 | 840 | 99 | |
| 06:20:55 | 8,750 | 840 | 99 | CL warning |
| 06:21:00 | 8,440 | 850 | 99 | |
| 06:21:05 | 7,590 | 850 | 98 | |
| 06:21:10 | 6,860 | 850 | 96 | Radar head has no data |
| 06:21:15 | 5,850 | 830 | 104 | |
| 06:21:20 | 5,120 | 740 | 102 | |
| 06:21:25 | 4,330 | 840 | 142 | Artifact |
| 06:21:30 | 4,110 | 930 | 145 | Artifact |
| 06:21:35 | 3,810 | 980 | 122 | |
| 06:21:40 | 3,380 | 1,010 | 115 | Last measured |
| 06:21:45–55 | Nil | 1,020–1,040 | 115 | Radar Prediction |

- 06:20:50→06:21:40: 5,490 m / 50 s = **21,600 ft/min** average; steepest segment, 06:21:10–15, about 39,800 ft/min.
- Horizontal distance over 50 s is about 10.7 km, mean groundspeed about 850 km/h.
- Track values from 06:21:25–35 are unreliable (see §5.4).

![Radar descent and track from 06:20:50 to 06:21:55](/assets/articles_mu5735_fig03_radar.png)

*Figure 4: Radar descent and track (06:20:50–06:21:55).*

### 6.2 Physical reconstruction (final 20 s)

| Quantity | Result |
|---|---|
| Roll rate | −32 ± 2°/s (plateau), peak −34.2°/s; cumulative over 16.3 s **−528° to −540°** (≈1.45–1.50 revolutions; ) |
| Pitch rate | Mean −1.74°/s, peak −3.76°/s; pitch attitude +2.46 → −35.86° |
| Flight-path angle | 0 → −29.1° |
| Nz | **16 Hz: −0.29…+1.29 g** (FDR 1-Hz sample −0.19…+1.19; decoded ARINC 717 data at 1 Hz 0.48–1.28 is a different convention), 88.5% <1 g; n=1/cosφ does not hold |
| Specific energy | 11,135.9 → 10,898.0 m, net loss −238 m over 19.4 s; altitude fell 1,134 m, of which 896 m became kinetic energy (79%) |
| IAS/TAS | 265→**339.75** kt (decoded ARINC 717 final value 337.5); TAS 409.8→484.1 kt (750→897 km/h); M 0.69→0.81 |
| Descent rate | 0 → 22,700 ft/min; final 8 s average −20,800 ft/min |
| Radar lag | 06:21:00 residual −215 m; optimal shifts of −1.25/−2.25 s reduce residual to 3.8/4.6 m → radar altitude lags FDR by about 1.5–2 s |

### 6.3 Impact

- Last measured point at 06:21:40: 3,380 m, 1,010 km/h, track 115°, final vertical rate −86 m/s.
- Pure vertical extrapolation: 06:22:12–19, landing point 23.260°N 111.064°E; **this extrapolation must be rejected**—**citation from outside the release**: the main impact point reportedly given in the CAAC's 2022-04-20 preliminary report, **23°19′25.52″N 111°06′44.30″E**, is **14.90 km, bearing 078.7°** from the last radar point; the straight-line extrapolated point is 8.6 km away. **Caveat**: this coordinate is not in the 1,959 pages in this release (vol. 8 p. 92 has a blank latitude/longitude field and only “5 Konts away from the Wuzhou airport”; the preliminary-report text is not in the package, and pp. 111–112 contain only the preliminary-report email subject, with the body withheld under b(5)). However, the **Chinese-language CAAC website statement of 2022-04-20 contains the coordinate verbatim**: “identified as the main impact point, located at 23°19′25.52″N, 111°06′44.30″E.” The English version omits the coordinate. It is therefore a **verifiable external primary source outside the package** ([CAAC notice, 2022-04-20](http://www.caac.gov.cn/XXGK/XXGK/TZTG/202204/t20220420_212895.html)), rather than merely a “high-confidence secondary citation.”
- A self-consistent explanation: after 06:21:40, a left turn of about 36° and reduction of the descent rate to a mean of about 61 m/s would require only 0.34 g laterally (≈19° bank), which is entirely feasible.
- Track geometry reconstruction: 11 measured points, 10 segments, **12.82 km along track / 50 s**, mean groundspeed **923 km/h** (chord mean 853); mean descent angle **24.9°** (chord) / 23.2° (track), glide ratio **2.16:1**, losing 464 m per km (about 9× a normal 3° glide path).
- The last measured point at 06:21:40 is **17.53 km / bearing 048.8°** from Wuzhou Xijiang Airport (coordinates from public sources; this is distinct from the “8.75 km from impact point to airport” measurement). The 115° extrapolated track passes no closer than **16.05 km** to the airport—the aircraft never came within 16 km of it based on radar coordinates. The notification form's “5 km outside the airport” is incompatible with radar geometry (a point 5 km away lies 20 km from the last point on a 242° bearing and would require a reversal); treat it only as a rough entry.
- The externally cited impact point is **14.90 km / bearing 078.7°** from the last measured point and **8.75 km** from Wuzhou Xijiang Airport (airport coordinates are public; the release only names “Wuzhou airport”). It is 8.6 km from the straight 115° extrapolation—at 1,030 km/h this is 52 s, giving **06:22:32**, or the final track turns from 115° to roughly 079° (same general direction as witness accounts of “trace from 85° to 95°” on vol. 8 p. 172; on the same page the CAAC notes that “statements are in conflict”).
- **Combined interval: 06:22:15–06:22:42Z, center 06:22:30 ±10 s (±5 km corresponds to about ±18 s; ±10 s is closer to the eyewitness window's ±13 s); position ±5 km, direction ±35°.** Prefer the externally cited point (verified on the official site; preliminary-report PDF not seen, so label accordingly); do not give a single exact time and point. The eyewitness window 06:22:14–40 falls within this interval.
- “5 km outside Wuzhou airport”: the last measured point is **8.75 km** from the Wuzhou Xijiang Airport reference point (23°24′05″N 111°05′55″E); the notification form's “5 Konts” is OCR / rounding and cannot constrain the location.

---

## 7. ACARS engine health

- **1,956 messages** (unique timestamps; CRZ 977 / TKO 979), 2021-04-13 00:54 → 2022-03-21 05:16 UTC, covering 327 days (343 calendar days, no messages for 16 days), 182 flight numbers, all B-1791 / MU / A85-27/28.
- **No fault, warning, or exceedance messages**: only CRZ and TKO types; no fault or warning bits; all values within normal 737-800/CFM56-7B envelopes (EGT 542–978, N1 73.5–101.6, GW 46,899–72,901, OilP 41–61).
- Accident-flight TKO, 2022-03-21 05:16:00Z (received by GE at 05:18:05): N1 100.1/100.1%, N2 99.9/99.8%, EGT 875/869°C, FF **per engine** 3,765/3,745 kg/h, TLA 77.2/77.1°, Alt 7,437 ft, CAS 170, Mach 0.295, GW 66,170 kg.
- **No cruise message for the accident flight**: all 31 earlier MU5735 flights on this aircraft had paired TKO+CRZ messages; median TKO→CRZ interval was 25 min. No later messages exist in the full dataset after 05:16. Cannot determine whether it was not downlinked, not received, or not released.
- Previous flight MU5864 (ZUC→ZPP): TKO 02:11Z, CRZ 02:34Z; preceding flight MU5863 on 03-20: 23:27/23:56.
- **Fuel-flow units**: the source has no unit label. Mass balance across 949 TKO→subsequent-message pairs establishes ACARS as **kg/h per engine** (the ratio of actual fuel burn to twin-engine cruise burn is a plausible 1.61 if kg/h, impossible 3.54 if lb/h). FDR Eng1/Eng2 Fuel Flow is **pph per engine** (two independent parameters, not total flow); accident takeoff 8,312 pph = 3,770 kg/h, within 0.13% of ACARS 3,765 kg/h.
- **Fuel check**: 10,100 kg at takeoff; using cruise 2,736 kg/h × 0.89 h + about 1,050 kg for climb + 300 kg taxi ≈ 3,800 kg, about **6,300 kg should have remained before landing**. “Fuel exhaustion” cannot explain both engines shutting down together; the FDR also has no fuel-quantity parameter.

### 7.1 Engine health trends (1,956 messages)

- **Annual EGT variation reflects weather, not deterioration**: monthly TKO medians 786–841°C track SAT; after accounting for GW/SAT/sampling altitude/N1, residual σ=5.7°C (R²=0.979), annual cumulative drift **+2.4°C** (Theil–Sen +2.5°C/year, 95% CI +1.3…+3.9); quarterly normalized EGT is only 860.9–862.7°C (1.8°C band, non-monotonic) → no material deterioration or step change.
- By engine: Eng 1 EGT residual +2.4 to +3.0°C/year, Eng 2 +0.2 to +2.0; Eng 1 oil pressure systematically 1–2 psi lower (87% TKO / 94% CRZ), FF higher by 15 kg/h → more consistent with **channel/sensor bias** than mechanical deterioration.
- No N1/N2 trend (CRZ N1 R²=0.975 σ=0.47%; N2 R²=0.991 σ=0.11%); FF–GW: takeoff 81 kg/h per tonne, cruise 22 kg/h per tonne; median twin-engine cruise flow by altitude band: 2,585 (18–26 kft) → 2,334 (35–40 kft).
- Vibration: no monotonic increase (maximum +0.04 units/year); two events—Eng 1 N1 TF step decrease around 2021-06-25 (permutation test p=0.007, then remained low), and an Eng 2 N1 TF transient cluster in 2021-12 (12 readings >1.0, peak 1.47, receded in January)—both more consistent with maintenance/sensor events.
- Anomaly detection: **90 hits / 81 messages (4.1%)**, with no message hitting ≥3 rules; the five most severe were vibration spikes or FF residuals at high load, with no persistent fault. Detectable thresholds: N1 0.75%, N2 0.375%, EGT 3–6°C, IAS 1.5 kt (≥3 s); Eng 2 N1/EGT/FF have a 40.64-min blind spot.
- **13 data-integrity anomalies** (9 messages with asymmetric twin-engine EGT, N2=66, N1=98/85.5, TLA=19/61, CRZ Alt=3,010 ft@M0.70) are all cell-level OCR damage (N1/FF/oil remain symmetrical and the next message returns to baseline); remove these before z-scoring.
- **Accident-flight positioning**: EGT1 875°C is at the raw 89.9th percentile; after matching 60 nearest samples by GW/SAT/altitude it is at the **44.2nd percentile**; in the tight match band (GW 64–68 t, SAT 18–23°C, Alt 6.5–8.5 kft, n=75) it is at the **42.0th percentile**; conditional residual **−6.1°C → 11.2th percentile**. N1 100.1% (93.7→86.7), FF 3,765 (62.5→57.5), oil 95°C (90.3→87.5). **High-normal, not abnormal**: explained by 66.17-t heavy weight + SAT 20.5°C + 7,437-ft sampling point; engines symmetrical and within the prior five MU5735 takeoffs (EGT 842–876).
- **FF unit confirmation: kg/h per engine**. FDR median Eng 1 flow at same altitude band (7,000–8,000 ft, N1>99) was 8,280 pph = 3,755.7 kg/h, versus ACARS 3,765 → **+0.25%**; if interpreted as twin-engine total, −49.9%; if as lb/h per engine, −54.5%. Cruise cross-check: ACARS FL290 band 1,234 kg/h versus FDR FL291 2,640 pph = 1,197 kg/h → **+3.0%**. For 925 mass-balance pairs (cleaned; 949 raw), actual burn 3,978 ÷ ACARS twin-engine cruise flow 2,455 = **1.61** (99.9% between 1.0–2.5); if lb/h, 3.54 (only 0.2% plausible).

![ACARS takeoff and cruise EGT and fuel-flow trends](/assets/articles_mu5735_fig06_acars_trend.png)

*Figure 5: ACARS takeoff/cruise EGT and FF trends.*

---

## 8. Volume 8: emails, PowerPoint, and investigation status

### 8.1 CAAC briefing PowerPoint, 2022-04-07 (pp. 157–175, 19 pages)

| Item | Value |
|---|---|
| Route | ZPPP LXI A599 GYA ZGGG; alternates ZGOW/ZSAM; planned 1:33 |
| Fuel | Planned 10,056 / trip 3,880 / Xiamen alternate 2,279 / CONT 650 / FINAL RES 1,300 / EXTRA 1,200 / RAMP 10,056 / **actual 10,100 kg** |
| Load | 3 flight crew + 6 cabin crew; **PAX 123**; cargo 2,288 / mail 368 / baggage 647 kg; **TOW 66,039 kg (max 68,300)**; MACTOW 20.96 (limit 11.24–30.8) |
| Crew | Captain age 31, ATPL, **7,496:51 h**, PC 2021-10-15, 48-hour duty 20:19, rest 12:45; F/O age 58, **34,461:08 h** (B737 19,134:13); S/O age 26, **CPL**, 744:27 h, 90-day 147:46 h; **seating and radio duties not confirmed** (S/O tentatively assigned radio calls) |
| Dispatchers | 3 (ages 27/27/31, all licensed) |
| Weather | ZPPP 210500Z 25010G16MPS CAVOK 25/00 Q1016; no severe turbulence en route; **no relevant NOTAMs** |
| ATC | 13:15 clearance / 13:16 takeoff / 13:27 8,900 m / 13:35 offset / 13:41 Nanning / 14:16 Guangzhou / 14:20 steep descent + CL warning / **14:21:40 final SSR point 3,380 m, 1,010 km/h, 117.8°** |
| Witnesses | **Interviewees: 38** (38 people interviewed), observation window 14:22:14–40, explicitly says “statements conflict”; bang, roll, pre-impact track 85°→95° |
| Manual review | Entire page says only “Under review.” |

### 8.2 Emails (174 messages + 4 documents, 2022-03-21 → 2024-03-21, 27 subject threads)

- Direction: CAAC→NTSB 38 / NTSB→CAAC 24 / internal NTSB 94 / third parties and public 16 (172 total; 2 more unclassified, 174 total).
- Redactions: **within vol. 8** b(5) 74 pages / b(6) 114 / either 121 (64.7% of its 187 pages); **entire release** including vol. 1 p. 34: 75/119/124.
- **CVR transfer**: on 3/24 the Chinese side reported the CSMU had been disinfected and cleaned; remote assistance on 3/24–25 (Lin → Silva → Greg Smith → Mrs. YU Liling → Zoom); recovery group on 3/28, NTSB received the module; the NTSB then repaired the connector, downloaded it, rated all four channels Excellent, and returned all audio to the CAAC. **“The NTSB never received the CVR” is false.**
- **2022-05-17 WSJ**: Silva told Lin that WSJ would publish a story and asked “whether the accident was the result of an intentional act”; this is followed by four consecutive blank b(5) redaction blocks—**the question remains, the answer is redacted**. Lin replied the same day, only thanking him for “remembering our concerns,” then changed the topic to the May 12 Chongqing A320 rejected takeoff and runway excursion; no position was stated on “intentional act.”
- **2022-04-20 preliminary report**: Lin 04:40 → Silva 07:41 “Just got this in.” → Frantz 12:16 → Silva 12:33 “Yep. As expected”; the body is fully withheld under b(5), and the report itself is not in the release.
- **Anniversary communications**: asked for an update 2023-01-27 → 2023-02-08 “I have no information to update”; on 2023-03-16 asked whether information or an interim report would be issued before the anniversary → 2023-03-20 “The attached is the interim statement” (attachment removed under b(5)); on 2024-03-21 Silva's long letter cited Annex 13 §§5.26/6.2 and 49 U.S.C. §1114, said “since a final report has yet to be issued,” and asked “your report timeframe” → Lin thanked him and offered a video meeting, **but gave no response at all on the schedule**.
- **Aireon**: report title is `AireonALERT Report for FLIGHT ID CES5735` (CES5735, not MU5735); the report itself is fully blacked out under b(5).
- **SSR**: 2022-04-09 MAO→Silva, with the attachment at pp. 180–181.
- **Undelivered items**: no later delivery in the release of the airline interview transcription or ADS-B data plot promised on 4/07.

### 8.3 Investigation status

- **CAAC's 2024-03-20 second-anniversary statement** (official website text): “Before takeoff, no faults or abnormalities were found in the aircraft systems, airframe structure, engines, etc.; no deferred defects; … crew qualifications and staffing met requirements; … relevant maintenance personnel were qualified.” China Daily's English report on 2024-03-21 also said “no anomalies.” This is the latest public official substantive update. It gives neither a cause determination nor a report schedule.
- No final report is public; the 2024-03-21 email is the strongest evidence that no final report had been issued **as of April 2026**.
- Of 15 promised items, 11 were not delivered at all, 3 partially, and 1 has unknown status.
- 859 pages fully withheld; 314 pages partially redacted in the response ledger; text redaction labels appear on 124 pages in the actual files; all CVR audio is held by the Chinese side.

### 8.4 Where the final approximately 70–97 seconds of CVR audio are (evidence chain)

- CSMU recovered on 3/23; after Chinese download attempts in Beijing failed on 3/24–25, assistance was requested; on 3/28 the NTSB received the module and formed a recovery group (“performed by NTSB personnel and overseen and recorded by CAAC personnel,” p. 4).
- Initial download: four audio tracks with the expected duration and sample rate, but **unintelligible / unusable** (p. 5, unrated).
- Chip-image route: 14 DLDR chip images → CHIPS `.du` → Playback32: panels **Fair**, CAM **Poor**, with repeated audio in the accident segment (pp. 9–10).
- Final download after opening the case, repairing the connector, and fitting a new shell: correct sequence, accident at the end, all four channels **Excellent** (pp. 12–13).
- Nine types of files returned to CAAC: original download, chip images, all `.du` files, all WAV files, time-corrected + 8k→16k upsampled audio, RAPT-R `.mdf`, enhancement, time stretching, photographs/microscope images; the NTSB kept only photos/scans/microscope images (p. 14).
- **Location of the final approximately 70–97 seconds** (three WAV families):
  - **Family A** (reassembled in chip-write order, accident in the middle): 8-kHz audio about **48.99–50.00%** (3,527–3,600 s; based on 14-chip striping it falls in the 6/14–8/14 slots, range 42.9–57.1%); CAM about **49.32–50.00%** (5,327–5,400 s).
  - **Family B** (final Playback32, chronological order, accident at the end): 8-kHz **98.99–100.00%** (01:58:47–02:00:00, byte offset 114,032,000 @16-bit); CAM **99.32–100.00%** (02:58:47–03:00:00, 343,264,000).
  - **Family C** (NTSB time-corrected/upsampled/stretched version): directly **06:21:05–06:22:15–42Z** (about 85 s using impact center 06:22:30), no estimate required.
  - Uncertainty: 0–9 min of residual recording after impact (battery upper bound) would shift the Family B anchor earlier, by at most 7.5%.
- Start of the 2-hour loop is about **04:22:30Z** (12:22:30 Beijing; during the previous flight's cruise); start of the 3-hour CAM loop is about 03:22:30Z (includes the previous flight's 11:42:23 takeoff). **The final approximately 70–97 seconds must be within the loop**; 10 minutes of battery capacity uses only about 14.2% (85 s / 600 s).
- Who has what: NTSB holds only photos/scans/microscope images + report + FDR; CAAC has nine file types + CSMU + duplicate photos + on-site records; China Eastern has CVR maintenance/self-test records; **the public has 0 seconds of audio**. The absence of CVR in the FOIA production is a **custody** issue, not an exemption.
- Most useful requests: ① time-corrected four-channel WAV + 8k→16k upsampled version (no estimation needed once obtained); ② RAPT-R `.mdf`; ③ 14 chip images + CHIPS `.du`. Also request the full set of photographs/scans/microscope images retained by the NTSB under p. 14.

### 8.5 Investigation administrative timeline (2022-03-21 → 2026-04)

The volume 8 analysis organizes 174 emails + 4 documents from volume 8 into **99 administrative events** (38 dates), in four periods:

- **Initial response (3-21–4-07, 53 events)**: 05:12 WOC notification → 05:19 initial report (132 POB, local 14:22) → **05:58 Aireon report arrived before the CAAC notification form at 09:48** (CES5735) → 09:48 CAAC notification form (B1791 / 06:30 UTC / 123+9 / IIC Lin Hang) → 3/24 CAAC formal invitation (requested passports; same email says “CVR has been retrieved and we hope to have your help”) → 3/28 parallel tracks (U.S. team traveled to China on DL287 / Chinese team traveled to U.S. for FDR repair) → 4/05 signed the Investigation Protocol → 4/07 operational-factors meeting on Zoom + 19-page PowerPoint.
- **Recorders and preliminary report (17 events)**: CVR CSMU on 3/23 → trans-Pacific technical channel 3/24 → recovery group and four unusable audio tracks on 3/28 → FDR CCA transfer 4/04 (golden chassis, DLDR all zeros, U2 crack) → CVR repaired, all four channels Excellent, all audio returned to CAAC → preliminary-report body fully withheld under b(5) on 4/20, report itself absent → 33-page report on 7/01.
- **Media and anniversaries (14 events)**: 5/17 WSJ “intentional act” question remains, answer removed in four b(5) blocks; Chinese-side 03:26 reply gives no position and diverts to Chongqing A320 on 5/12; progress asked in 2023-01 → 02-08 “no information to update”; interim report asked about on 03-16 → interim statement on 03-20 (body b(5), attachment absent); seven anniversary strategy emails on 03-21, all b(5).
- **Second anniversary and FOIA (15 events)**: 2024-03-21 04:52 long letter (Annex 13 filed differences, §1114(f), “final report has yet to be issued,” FOIA risk, flight data most sensitive, asks report timeframe) → 07:41 Chinese side “willing to have a video meeting,” **no words on timing** → 22 months later, two FOIA requests in 2026-01 → response in 2026-04.

**Five largest gaps**: G1 preliminary report (4/20, entire body b(5), report absent); G2 interim statement + anniversary strategy (2023-03-20/21); G3 answer to WSJ's “intentional act” question; G4 report schedule (asked four times, no answer); G5 promised items and the full record (15-item ledger, 11 undelivered; 2024-03-20 letter body missing; 859 pages fully withheld; 190-page gap between 314 and 124).

![Investigation administrative timeline, 2022–2026](/assets/articles_mu5735_fig08_investigation_timeline.png)

*Figure 6: 2022–2026 investigation administrative timeline (99 events).*

---

## 9. Conflicts and unresolved questions (summary)

| # | Conflict | Assessment |
|---|---|---|
| C01 | Was the CVR given to the NTSB? | NTSB received and downloaded it, then returned it to CAAC and retained no audio. “Never received” is false. |
| C02 | Accident time: 06:30 / 06:21:40 / 06:22:30 | 06:30 is rounded on the notification form; 06:21:40 is the last radar point; impact was about 06:22:30. |
| C06 | ARINC 717 time bases differ by 1.385× | The previous-flight data are uncorrected; use only the corrected combined flight data for absolute synchronization. |
| C04 | FDR stop altitude: 26,000 / 25,389 / 25,506 | Report is rounded; cite 25,389 ft. |
| C07 | CVR quality Fair/Poor vs Excellent | Two downloads; the first audio download unusable, then Fair/Poor after connector repair, Excellent after replacing the shell. |
| C09 | FOIA withheld/redacted: 478/122 vs 859/314 | 478/122 covers b(5) only; overall full withholding is 859, partial redaction 314 (ledger). |
| C12 | FDR stopped at 14:20:51 / 14:21:04 / 14:21:05 | Interval is 14:21:04–07. |
| C13 | Impact at 14:22:05 vs 14:22:18 vs 14:22:30 | Center is 14:22:30 ±10 s. |
| C14 | FIRE once vs 213 times | 213 are 8-second artifacts; valid data contain 1,336 NO FIRE entries, with the only FIRE in the final bad frame. |
| C15 | ACARS FF kg/h per engine vs lb/h per engine vs total flow | **kg/h per engine** (mass balance); FDR is pph per engine. |
| C17 | Cruise 8,900 m vs 29,227.6 ft | 29,227.6 − 125.6 = 29,102 ft = 8,870 m; CAAC's 8,900 m is rounded. |
| C18 | Witness track 85→95 vs radar 115 | Eyewitness account is weak corroboration, not a precise location fix. |
| C22 | AP disconnect: summary grid vs original-sample data differ by 1.5 s | Use the original-sample data: AP-1/AP-2 warnings at 288960.43; AP disconnect at 288960.80. |

**Still unresolved**: ① final deceleration (descent rate falls abruptly from 158 m/s to 44 m/s between 06:21:25–30): actual pull-up or altitude-indication jump; ② no CVR data; ③ missing accident-flight ACARS CRZ message (not downlinked / not received / not released); ④ no explanation for the FDR counter epoch (80.27 h); ⑤ degraded radar track from 06:21:25–35 cannot be recovered.

---

## 10. Limits and conclusions

- What can be established: the fuel control switch parameters changed; the aircraft was repeatedly commanded left with normally operating control systems (control wheel varied from −19° to −102°, not a steady single full-left input); it entered about 1.45 revolutions of left roll and a −36° dive; the FDR stopped after generator dropout; radar recorded a 21,600-ft/min descent.
- What cannot be established: who, why, or whether it was intentional; the FDR cannot distinguish intent, incapacitation, a struggle, or common-mode failure; the CVR is critical and is held by the Chinese side.
- Official conclusion: the CAAC is the lead authority; no final report was public as of the April 2026 release; the 2024-03-21 email still said “since a final report has yet to be issued.”
- The 737NG fuel-control switch's lift-to-move detent is supported by FAA SAIB NM-18-33 (“must be lifted to move”), but **the same SAIB concerns detent failure that can allow movement without lifting**. Thus “must be lifted” cannot prove that non-human movement was impossible; it is design context only.
- **Sensitivity analysis**: of 10 core conclusions, **5 robust, 4 moderate, 1 fragile**. Most robust: both engines shut down in sync (does not depend on the discrete-state column); hydraulics/fire warning/twin-engine symmetry; the fuel control switch parameters changed (16 continuous CUTOFF values in the original-sample data plus the engine-decay onset independently anchor it). Most fragile: **impact geometry**—the full “36° left turn + pull-up” reconstruction depends on the external CAAC preliminary-report point; ±5 km corresponds to about ±18 s, and without that point the result reverts to pure extrapolation at 06:22:12–19. Rudder pedals / cumulative roll / control input attribution are moderate: direction is robust, but FDR alone cannot establish the exact value or attribution to a “human hand.”
- When citing: do not use “about 26,000 ft” as a measured value; do not treat 06:30 as impact time; do not treat the previous flight's ARINC 717 absolute-time alignment as true; do not use the rudder channel as evidence the rudder functioned normally; do not treat the 06:21:25–35 radar track as an actual turn.

---

## Appendix A: Figures

| Figure | Contents | Convention / note |
|---|---|---|
| Figure 1 | Main accident-day timeline (BJT/UTC dual scale, 12:54–14:23) | CUTOFF 14:20:48, FDR stop ≈14:21:05, **impact ≈14:22:30 (14:22:15–42)**; 14:22:18 is only an alternative from pure vertical extrapolation. Corrected version used |
| Figure 2 | Final 60 s, six panels (altitude/IAS/roll/control wheel/N1/N2) | 1 Hz; CUTOFF, AP disconnect, FDR stop markers; final IAS **339.75 kt** (corrected) |
| Figure 3 | Radar altitude + groundspeed/track angle | 06:21:45–55 extrapolation shown as hollow/dashed, not measured |
| Figure 4 | Both flights: altitude/IAS/N1 vs. block | Previous flight's absolute time is an upper bound under a “continuous recording” assumption and must be reduced by Δ; **takeoff = liftoff block 187 (takeoff roll begins at 138), touchdown 4534**; labels split left/right |
| Figure 5 | 53-min cruise N1/EGT/FF drift | Rolling median + linear fit; cycle variation about 6 min |
| Figure 6 | ACARS EGT/FF trends | FF unit kg/h is inferred by mass balance; EGT negative trend is mainly seasonal |
| Figure 7 | Page types, redactions, 190-page discrepancy | Seven categories total 1,957 + 2 vol. 1 emails = 1,959; b(6) page-by-page count 119 vs. summary 117 is noted |
| Figure 8 | 2022–2026 investigation administrative timeline | 99 events, 7 swimlanes, 7 delivery statuses, five gaps |

Figures 4, 5, and 8 use visually revised versions (split labels, separate statistics rows, and bold swimlane titles); the statistics row in Figure 5 and lane titles in Figure 8 were visually checked for readability.

All figures are 1500–1800 px wide, with a white background, Arial text, and source credits at lower right. Figures 1–8 use corrected versions; earlier versions with the old time base (13:16:00/14:20:35/14:20:51, etc.) are not cited in this report.

## Appendix B: Evidence limits

| Material type | Analysis completed | Remaining limitation |
|---|---|---|
| NTSB FOIA production | All 1,959 released pages OCR'd and classified; 52 pages checked at 300 dpi | 859 pages fully withheld; 314 pages partly redacted in the response ledger (124 actual text labels, 192 black boxes); b(5)/b(6) bodies are not in the release |
| FDR tabular data | 165 parameters audited; 143 usable; event segment reconstructed | 63 status parameters are text enumerations; three full-second data losses; final bad frames; no fuel quantity or Stab Trim |
| ARINC 717 flight data | 31 of 32 channels decoded | Oil Press/Temp have only 4–7/3 distinct values and are nonphysical; Flap is an 8-s square-wave artifact; Stab Trim is not among the 165 parameters |
| ACARS engine messages | All 1,956 messages parsed; trends, anomalies, and accident-flight TKO reviewed | EGT Margin entirely blank; ESNs all zeroed; no fault/warning messages; no accident-flight CRZ |
| Investigation correspondence | 174 messages indexed; CVR/WSJ/preliminary-report/anniversary topics examined in depth | 121/187 pages contain redactions; preliminary report, interim statement, and 2024 letter body removed |
| Engine maintenance records | Parts / LLP ledger reviewed | Records cover only the 2015 new-aircraft entry; no AD/SB, repairs, or remaining LLP life |
| Photographic evidence | 47 pages catalogued, including part numbers and cracks | Resolution/angle are limited; 39 pages are mainly wreckage/scene views and do not support quantitative damage analysis |
| Recorder examination report | All 33 pages transcribed | pp. 25–27 plots share source data with the FDR tables; digitizing them adds no new parameters |
| Secondary-surveillance radar data | 14 rows analyzed for point geometry, descent rate, and impact constraints | 06:21:45–55 are Radar Prediction, with no altitude |
| Existing analytical notes | 128 claims checked one by one | 15 conflicts, 18 unverifiable |
| CVR evidence | Evidence chain and final approximately 70–97-s location assessed | Audio is held by the Chinese side; FOIA production contains 0 seconds of audio and 0 transcripts |

**Conclusion**: The released package has been used page by page, item by item, and column by column. Remaining items are either physically absent from the package (859 pages, CVR audio, extracted bodies) or cannot be resolved from the available data (Oil/Flap/Stab, blank EGT Margin, photograph resolution). Further analysis of these files has near-zero marginal value; the next gain depends on obtaining records, not rereading this package.

---
