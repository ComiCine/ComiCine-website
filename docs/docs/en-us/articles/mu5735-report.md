---
title: "MU5735 / DCA22WA102 Accident Investigation Materials Analysis Report"
description: "Review of MU5735 recorder reports, flight data, ARINC 717 data, ACARS messages, radar records, correspondence, and calculated results."
outline: [2, 3]
aliases: [MU5735 Report, DCA22WA102 Report]
date: 2026-11-08
version: 2.2
tags: [MU5735, DCA22WA102, aviation accident, FDR, CVR]
---

# MU5735 / DCA22WA102 Accident Investigation Materials Analysis Report

Sections 0–1 summarize the event and timeline; §§3–7 present recorder, radar, ACARS, and correspondence data and the associated analysis. Section 8 lists documented discrepancies and data status; Section 9 summarizes the principal findings.

---

## 0. Summary

On 2022-03-21, China Eastern Airlines flight MU5735 (B-737-800, B-1791, Kunming ZPPP → Guangzhou ZGGG) crashed in Wuzhou, Guangxi. All 123 passengers and 9 crew members on board were killed. The CAAC led the investigation under Annex 13, with NTSB assistance. Four years after the accident, in April 2026, the NTSB released 1,959 pages of records, two FDR tables, and three FDR raw files under 49 U.S.C. §1114(f).

**Recorded sequence and estimated timeline:**

At cruise altitude 29,103 ft, the FDR fields `Eng1 Cutoff SW` and `Eng2 Cutoff SW` changed from RUN to CUTOFF within the same one-second sampling window. About 1.8 s later, the recorded `Left Control Wheel Position` was −28°; it then varied repeatedly between leftward positions and values closer to neutral while the aircraft continued rolling left. The recorded roll reached about 1.45 revolutions as pitch attitude reached −35.86°. Both engines' N2 values fell below the generator cutoff speed, after which the FDR powered down at 25,389 ft. Radar data show a descent rate of 21,600 ft/min and a last measured point at 06:21:40. The impact time is estimated at about 06:22:30. The NTSB report states that the accident sequence was captured on the CVR and rates all four channels Excellent. The audio was returned to the CAAC and is absent from this release.

### Summary of record-based observations and calculations

1. At cruise altitude 29,103 ft, **the FDR fields `Eng1 Cutoff SW` and `Eng2 Cutoff SW` changed from RUN to CUTOFF within the same one-second sampling window**. N2 then declined monotonically from 92.4% to 49.9% (Eng 1) / 52.5% (Eng 2); N1 from 83.5% to 25.6% / 25.8%; EGT from 623°C to 395 / 397°C; and fuel flow reached 0. **The FDR's `Left Engine Throttle Resolver Angle` and `Right Engine Throttle Resolver Angle` values (TRA) remained within 58.9°–60.1° throughout.**
2. The first valid control-position sample was recorded about 1.8 s after cutoff: **`Left Control Wheel Position` was −28.1°**. It then varied between −19° and −102°, with a peak of −101.95° and a median of about −47°. The recorded aileron-position parameters reached about +17.8° / −18.4° at maximum deflection. **The aircraft continued rolling left, accumulating about −528° to −540° over 16.3 s (≈1.45–1.50 revolutions), at an average −32 ± 2°/s. Pitch attitude changed from +2.46° to −35.86°; IAS from 265 to 339.75 kt; altitude from 29,103 to 25,389 ft.**
3. FDR-recorded hydraulic pressure was A 2,960–3,004 / B 2,972–3,016 psi. Aileron, elevator, control-wheel, and control-column parameters changed during the recorded interval. Both engine fire-warning indications were NO FIRE in valid data, and both engines decayed in sync, with neither failing first.
4. **Both engines' N2 values fell below the generator cutoff speed; the FDR then powered down at about 25,389 ft.** The FDR had no battery backup and depended on power from the aircraft generators. The inferred N2 cutoff threshold is about 49% (48.6–49.9%, **inference**) at about 06:21:06–07Z. The last measured radar point at 06:21:40Z was 3,380 m, about 4,300 m below the FDR's last valid altitude.
5. **All four CVR channels were rated Excellent** (about 120 min on each of the three audio panels and about 180 min on CAM). The NTSB received the recorder, downloaded it, and returned all audio to the CAAC. The FOIA response letter (`NTSB_response_to_FOIA_request_on_China_Eastern_Airlines_Flight_MU5735_alternative_version.pdf`, p. 3) states that the Safety Board does not possess CVR data responsive to that request; the recorder report states that the NTSB retained photographs, scans, and microscopic images. **The FOIA release contains no audio or transcript.**
6. **The April 2026 release contains no final report.** Volume 8 emails show that the NTSB was still asking for a report schedule on 2024-03-21. The substantive CAAC reply is redacted under (b)(5); the visible portion thanks Silva and offers a video meeting. The 2024-03-21 letter states that “a final report has yet to be issued.” The CAAC’s 2024-03-20 second-anniversary statement says that “no faults or abnormalities were found in the aircraft systems, airframe structure, engines, etc. before takeoff”; it gives no cause determination or report schedule.

---

## 1. Timeline (absolute times with ranges)

### 1.1 Time bases

- CAAC/ATC times are Beijing time (UTC+8); ACARS times are UTC; FOIA emails use Eastern Daylight Time (EDT, UTC−4).
- FDR `Time (sec)` is the recorder's internal counter (288,200–288,978 s), rather than clock time. Clock time was calculated from the end of recording and radar data.
- **The ARINC 717 data-block length is 1.000 s/block** (the U2 gap recurs every 8 blocks = 8 s in the NTSB data; the full-segment altitude fit gives B=1.0, while B=1.0195 has RMS 12,980 ft). The previous-flight ARINC 717 data have a time base stretched by 1.385× and are excluded from absolute-time synchronization.

### 1.2 Main timeline (key intervals)

| Beijing time | UTC | Event | Basis |
|---|---|---|---|
| 12:54 | 04:54 | Crew first contacts Kunming ATC | vol. 8 p. 174 |
| 13:15 | 05:15 | Kunming Tower issues takeoff clearance | vol. 8 p. 174 |
| **13:16:26** (13:15:53–13:16:50) | **05:16:26** | **Liftoff**; ACARS TKO message at 05:16:00Z | ACARS + FDR + CAAC |
| 13:27:26 | 05:27:26 | Reaches and maintains 8,900 m (29,199 ft); FDR reads 29,228 ft (including −125.6 ft offset) | CAAC + ARINC 717 data |
| 13:35 | 05:35 | ATC instructs a 5-nm offset; during the same minute the FDR shows a −27° left-bank maneuver (direction inconsistent with “right”) | vol. 8 p. 171; ARINC 717 data |
| 14:16 / 14:17 | 06:16 / 06:17 | Contacts Guangzhou Area Control / enters Guangzhou control area | vol. 8 pp. 171/174 |
| **14:20:48** (14:20:45–14:20:50) | **06:20:48** | **The FDR fields `Eng1 Cutoff SW` and `Eng2 Cutoff SW` change from RUN to CUTOFF**; 29,103 ft; first radar row is 8,870 m | FDR + radar |
| 14:20:55 | 06:20:55 | Radar **CL warning** (Deviation from Cleared Level) | SSR table |
| 14:21:05 (14:21:04–14:21:07) | 06:21:05 | **FDR stops recording**: 25,389 ft / 339.75 kt / N1 25.6% | FDR + radar |
| **14:21:40** | **06:21:40** | **Last measured secondary-surveillance radar point**: 3,380 m, 1,010 km/h, 117.8° | CAAC + SSR table |
| **≈14:22:30** (14:22:15–14:22:42) | **≈06:22:30** | **Estimated impact** (time range 06:22:15–42; position uncertainty about ±5 km); the CAAC's 2022-04-20 notice identifies 23°19′25.52″N 111°06′44.30″E as the main impact point | Radar + track geometry + CAAC notice |
| 14:22:14–40 | 06:22:14–40 | Eyewitness observation window (38 interviewees; CAAC's own note says “statements are in conflict”) | vol. 8 p. 172 |
| 14:30 | 06:30 | CAAC notification form says “about 06:30”; copied on the NTSB cover | vol. 8 p. 92; vol. 1 p. 3 |

The notification form records the time as “about 06:30.” This is 8 min 20 s after the last radar point at 06:21:40, 8 min 55 s after the nominal FDR stop time at 06:21:05, and 7 min 20 s after the end of the eyewitness window at 06:22:40.

### 1.3 Three timeline conventions

| Quantity | Value | Explanation |
|---|---|---|
| CUTOFF | 06:20:45–50Z | Radar-altitude fit used for the estimate is 06:20:48; FDR counter 288,958.586 |
| FDR stop | 06:21:04–07Z | Strict anchor 06:21:06.98; timeline value 06:21:05; radar interpolation 06:21:04.1 |
| Impact | 06:22:15–42Z, center 06:22:30 | Pure vertical extrapolation gives 06:22:12–19; the CAAC notice gives the reported main impact point, about 8.6 km from that extrapolation |
| Liftoff | 13:16:26 (13:15:53–13:16:50) | ACARS whole-minute time + ARINC 717 data: 64.37 min (liftoff→CUTOFF) / 64.85 min (→FDR stop) + CAAC 13:16 |

**Text description:** The dual BJT/UTC timeline marks liftoff at 13:16:26, about 8,900 m at 13:27:26, dual-engine CUTOFF at 14:20:48, FDR stop at about 14:21:05, and the last measured radar point at 14:21:40 (3,380 m). Impact is estimated near 14:22:30, with an inferred interval of 14:22:15–42.

---

## 2. NTSB Cockpit Voice and Flight Data Recorder Combined Download Report (33 pages, 2022-07-01; `FOIA Release Records - DCA22WA102 (1).pdf`)

### 2.1 CVR (Cockpit Voice Recorder; Honeywell HFR5-V, P/N 980-6032-001, S/N CVR-04014)

- The CVR was recovered on March 23 with severe impact damage. The Chinese team made repeated unsuccessful download attempts in Beijing using a replacement chassis.
- The NTSB received a CVR download file on March 28. Playback32 extracted four WAV audio files, but they were **unintelligible / unusable** (p. 5).
- Microscopic examination: connector solder pads broken, pins deformed, and ground plane fractured; more pins were found pressed down after the case was opened; one power-filter capacitor had already been unsoldered at manufacture.
- After connector repair, a DLDR chip image plus Playback32 produced **Fair** audio on the three audio panels and **Poor** on CAM (p. 10).
- The CSMU was opened, fitted with a new connector shell, connected to an NTSB HFR5-V golden chassis, and downloaded again; **all four channels were rated Excellent** (p. 13): about 120 min each for the Captain's, First Officer's, and Cockpit Observer's audio panels, and about 180 min for the Cockpit Area Microphone (CAM).
- The report also notes nonlinear time drift between CAM and the crew channels and random packet loss on narrowband channels.
- **All audio, raw files, and intermediate files were returned to the CAAC; the NTSB retained photographs, scans, and microscopic images only, not audio.**

### 2.2 FDR (Flight Data Recorder; Honeywell HFR5-D, P/N 980-4750-009, S/N FDR-02952)

- 512 12-bit words per second; 512-word block = 1 second = one subframe; sync words distinguish subframes 1–4.
- Received April 4; conventional download failed and the image was all zeros. A crack in flash chip U2 ran from the package edge to the center of the die. The six data chips U1–U6 were removed and read directly; **U2 was unreadable**, while the other five were successful.
- A placeholder all-FF file replaced U2 to generate a DLU; the accident segment was in the middle of the data stream and was manually rearranged to the end.
- Data were striped across the chips, about 1.3 s per chip → **6.5 s valid + 1.3 s gap**. The software incorrectly inserted four samples for every eight subframes, creating about 4 s of false gaps; alignment was manually corrected at each boundary.
- **Only the final 12 minutes were made into a time-accurate version**; the previous flight's landing/taxi portion was corrected.
- Recording ended at about 26,000 ft (actual last valid sample: 25,389 ft). Both engines' N2 values fell below the generator cutoff speed; the FDR has no battery backup and powers down without power from the aircraft generators. The CVR has a battery and can continue recording for at least 10 minutes after the loss of the aircraft generators.
- **The only passage about the accident sequence (p. 23)**: during cruise at 29,000 ft, the fuel switches on both engines moved from RUN to CUTOFF, after which engine speeds decreased.

### 2.3 Report contents

The report documents recorder repair, readout, and transfer; it contains no accident-sequence analysis or cause determination. The signature is on p. 24, pp. 25–27 contain FDR plots, and pp. 28–33 are appendices.

---

## 3. FDR event (final approximately 19 seconds)

Source tables: `DCA22WA102-220414-AllValidated-ExactSample.csv` and `DCA22WA102-220414-AllValidated-TableResolution.csv`.

> T=0 is `Time=288958.5859` (FDR fields `Eng1 Cutoff SW` and `Eng2 Cutoff SW` both show CUTOFF). T is recorder-counter seconds; the last valid sample is T+18.75 (25,389 ft / 339.75 kt), and the last raw sample is T+18.95.
> Values in the table come from original FDR sample data (preferred for discrete parameters) and the 1/16-second FDR summary grid; roll is wrapped at ±180°, with unwrapped values noted separately.

### 3.1 Event table

| T | Altitude ft | IAS kt | Pitch ° | Roll ° | Left Control Wheel Position ° | Aileron L/R ° | N1 E1/E2% | N2 E1/E2% | EGT °C | FF pph |
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

- **T+1.82**: first valid `Left Control Wheel Position` sample (−28.13°; ailerons +3.31/−1.99°; roll rate −2.5°/s).
- **T+1.85**: AP-1/AP-2 disconnect warnings; **T+2.04** A/T disconnect; **T+2.22** AP → F/D Only (CMD A Not SELECTED).
- **T+0.3–1.8**: U2 gap of about 1.4 s.
- **T+18.75**: last valid sample; **T+18.95**: recording terminates.

**Text description:** With both engine cutoff switches showing CUTOFF (FDR second 758.6) as T=0, the six traces cover T−45 to T+20 s: altitude, IAS, roll, `Left Control Wheel Position`, N1, and N2. Shaded gaps are dropped FDR samples and are not interpolated. The last valid sample is about T+18.75 s; recording ends at T+18.95 s.

The unwrapped final roll value at T+18.75 is −527.9°; integration over the full 8-Hz window gives −540.4°. The −528 to −540° range in §§3.3/5.2 uses the rounded lower bound from −527.9 (a 0.1° difference) and the integrated upper bound. **The table's +143.4/+59.2 values are wrapped at ±180°; their unwrapped values are −216.6/−300.8, consistent with continuing left roll.**

### 3.2 Engines

- N1 83.5 → 25.6/25.8%; N2 92.4 → 49.9/52.5%; EGT 623 → 395/397°C; single-engine FF 2,608 → 0. An intermediate rebound from 304 to 1,056 is a reconstruction artifact and is excluded from the actual fuel-flow sequence.
- **The `Left Engine Throttle Resolver Angle` and `Right Engine Throttle Resolver Angle` values (TRA) stayed within 58.9°–60.1° throughout**, while the NTSB report states that “the fuel switches on both engines moved from the run position to the cutoff position.”
- Both engines decayed synchronously. Valid data contain no fire-warning indication; the only FIRE indication occurs in the final saturated bad frame.

### 3.3 Controls and attitude

- Recorded `Left Control Wheel Position`: +3.5° → first valid sample −28.1° → peak **−101.95°**; event-segment **median about −47°**. **18%** of samples were ≤ −90°. The recorded position varied repeatedly between −19° and −102°.
- Recorded aileron-position parameters reached about +17.8°/−18.4° at maximum deflection; elevator values changed from −4.5° to −7.7°, control-column values from 0.2° to −5.0°, and control force ranged from about −0.95 to +0.71 lb. The force sign convention is not supplied.
- Roll: continued in the same leftward direction, accumulating **about −528° to −540° over 16.3 s (≈1.45–1.50 revolutions)**, average **−32 ± 2°/s**; pitch attitude +2.46 → −35.86°; Nz **about −0.29…+1.29 g** (88% of samples < 1 g).
- The rudder-position channel is fixed at −1.0° in 5,052 of 5,133 samples; −54° appears only in the final bad frame. The `Rudder Ped Pos` field ranges from −0.99° to 0.00° (11.42° is a full-scale bad frame at 288977.449); `Rudder Servo Cmd` ranges within ±2°.
- Hydraulic pressure A 2,960–3,004 / B 2,972–3,016 psi; no fire warning; no thrust asymmetry.

### 3.4 Data quality

- **165 columns = 1 time + 101 numeric + 63 status/text**. The raw FDR fields are `Eng1 Cutoff SW` / `Eng2 Cutoff SW`; the NTSB validated-parameter list calls them `Left Engine Cutoff Switch` / `Right Engine Cutoff Switch`. `Ctrl Whl Pos-L` is listed as `Left Control Wheel Position`; `Eng1 TRA` / `Eng2 TRA` correspond to `Left Engine Throttle Resolver Angle` / `Right Engine Throttle Resolver Angle`. Status columns (AP/AT, fire warning, cutoff switches, electrical power, hydraulic pumps) appear as **text enumerations** in the FDR summary grid. Discrete-state analysis uses the original-sample FDR data because summary-grid gaps are filled as CUTOFF/FIRE/F-D Only.
- **38,548/231,885 = 16.6% of values in the 101 numeric parameters of the FDR summary grid are fill codes** (−1, 1023, 16368, 4092, 127.88, 511.75, 65520, 5.9996, 179.8, etc.); the original-sample data do not show the same fill-code pattern.
- Quality assessment: 136 good + 7 usable = 143 columns directly usable; 17 degraded/partial; 5 unusable (three radio altimeters, Selected Airspeed FCC, Selected Mach FCC).
- **Three full-second gaps** occur at rel 31.9375, 703.9375, and 719.9375. Each interval is 1.000 s, with zero samples for all 164 parameters; the summary grid skips 16 rows without interpolation, while surrounding values are continuous. These observations indicate one second of missing FDR data during cruise, separate from reconstruction artifacts and outside the accident sequence.
- There are also inherent U2 stripe gaps of **about 1.3 s every 8 s**; these are separate from the three full-second gaps.
- **Two invalid frames occur in the final second**: a zeroed frame at 288976.63–.86 (13 analog values) and a full-scale frame at 288977.40–.54 (33 analog values, including Rudder −54, TRA 143.6, N2 102.125, Accel 4.11 g). The reconstructed sequence ends at 288977.38 s.
- **0.31–0.55 s of data follow the 28VDC BAT BUS/STDBY BUS OFF indication at 776.791 s** (altitude 777.338, IAS 777.334, N1 777.213, EGT 777.113, hydraulics 777.100, DC BUS 1 777.172 ON, HOT BAT 777.174 ON). This interval is classified as a bad frame; if genuine, it would represent a battery-bus transient. An N2 threshold of 45% would occur 2.85 s later / about 24,401 ft; 55% would occur 5.15 s earlier / about 27,175 ft. The NTSB report states that the FDR had no battery backup; the cessation of recording is consistent with loss of aircraft-generator power.
- The two FDR data representations differ systematically: the summary grid fills gaps with −1.0 ft / 511.75 kt / 127.875 / 4092 psi / CUTOFF / FIRE / F/D Only. Discrete states are assessed from the original-sample data. `AP Off` alternates between On and F/D Only every second; the AP-1/AP-2 warnings or CMD A provide the disconnect timing.
- Of 130 CUTOFF entries per engine in the summary grid, **110 (84.6%) are U2-gap fills** (t mod 8 = 7.5625/0.5625); among the 20 per engine in the accident block, the original-sample data support 16. The same 8-second U2 gap cycle accounts for 213 FIRE entries, 175 APU ON entries, and 98 flaps 40° entries.

---

**Recorder power and radar sequence:** Both engines' N2 values fell below the generator cutoff speed. The FDR, which had no battery backup, powered down at 25,389 ft after aircraft-generator power was lost. Radar data continued to 3,380 m at 06:21:40, about 4,300 m below the FDR's last valid altitude. The estimated impact time is about 06:22:30 (see §5).

## 4. ARINC 717 decoding and two-flight profiles

### 4.1 Decoding method and calibration

Source ARINC 717 files: `DCA22WA102-Final12minutes.upk`, `Last2Flights(final).upk`, and `PreviousLanding+LastFlight_PartiallyCorrected(AsOf220414).upk`.

- ARINC 717: 512 12-bit words per second; 512-word block = 1 s; sync words 0x247/0x5B8/0xA47/0xDB8 cycle every four seconds; 0xFFF is invalid.
- **Block structure = 16 minor frames × 32 words**; each parameter is assigned to a set of minor-frame phases, leaving one unknown slot k (0–31).
- Time alignment: **T0 = 43.000 s** (block i ↔ 288,243.0+i; add mf/16 s for the minor frame and k/512 s for each word). **Aligning to NTSB row number `640+16i` without accounting for three one-second gaps creates a 3-s drift; the cross-check supports T0=43.000 s.** The 8-Hz cross-check used pointwise residuals: at T0=43.0, Roll/Pitch residual p90 falls from 0.178° to 0.003° (a quantization step). Block length is **1.000 s** (U2 gap every 8 blocks = 8 s; rejected B=1.0195 because its full-segment altitude RMS is 12,980 ft).
- Altitude: The calibrated scale is **31.807 ft/count**; the earlier formula `raw×32.08+99` is systematically 126.6 ft high (physics fit 125.6 ft; the 1-ft difference reflects the fit window). Calibrated cruise altitude is 29,102 ft = FL291, and final altitude is 25,389 ft, matching radar 8,870 m at 06:20:50 within 0.3 ft. The quantization interval is 32 ft; smaller differences fall within that interval.
- Verified: IAS median difference 0.00 kt, EGT 0, N1 0, **N2 bit-exact**; roll/pitch/wheel p95 <2°; decoded channel-slot and timestamp inversion agree **31/31** (median per-sample timestamp grid residual 1.9e-5 s).
- **The final decode has 32 channels**, including Roll_Rate, Accel_Lat/Long, Eng2_EGT/FF/N1, and HydB; 31 are decoded, while Flap remains undecoded. Aileron scales **17.309/17.539**, rudder **17.844**; elevator/control-column scales are essentially unchanged. Median residuals: ailerons **0.0138/0.0117°** (176×/245× better than the earlier calibration), elevator 0.00065/0.00106° (3.3×), control column 0.00152/0.00581° (5.3×), rudder 0.0282° (3×), roll rate 0.0093°/s.
- **Accel Lat/Long are decoded**: scale 1964.4/1964.6 counts/g, residual 5e-5/3e-4 g (export precision), confidence medium (±5%). Oil Press/Temp and Flap remain undecoded; Flap shows an 8-s square-wave artifact. Stab Trim is not among the 165 columns. The previous-flight ARINC 717 data lack an independently supported block-to-absolute-time alignment.
- **Independent cross-check**: **31/31 channels reproduced**; aileron scales 17.309/17.539 remain consistent; rudder scale 17.844 may be 10–15% low (quantization-level back-calculation suggests about 15.4); altitude-change quantization median is 32.5 ft (versus 2.1 ft in cruise). The negative-time segment of the combined two-flight ARINC 717 data has 7 all-zero blocks / 3 damaged blocks; the accident segment is unaffected (735/735 blocks match the accident-flight data). The sign of the Elevator_R calibration offset in the parameter mapping was corrected.
- **8-Hz check**: recorded left control-wheel position P2P **105.5°** (no right-wheel series was used); aileron L/R P2P **19.8/21.8°**; roll-rate P2P **48.8°/s** (slot 9/odd, raw/15.992, residual 0.0093); control column 8.7°, elevator 7.7°, rudder 3.1°.
- Recorded `Left Control Wheel Position` samples 719/725–726/729–730 reached −99…−102°; samples 723/728 were −26…−9°. The primary frequency was about 0.09–0.10 Hz, with about 19% of the energy at 0.7–1.5 Hz from rapid variations. Wheel-to-aileron lag was 46 ms (r=−0.993), aileron-to-roll-rate lag 0.56 s (r=−0.972), and roll angle lagged roll rate by 89.2° (integrator).

### 4.2 Accident flight

| Phase | Duration | Data |
|---|---|---|
| Ground/taxi/hold (including start and shutdown) | 13.75 min | 6,900 ft, N1 0–36.1%, EGT 111.5–573.5°C |
| Takeoff roll | 0.87 min | N1 28→100.4%, IAS 45→167 |
| Climb | 11.32 min | 6,900→29,228 ft (calibrated 29,102), average 2,033 ft/min, N1 95–100%, EGT 786–875°C |
| Cruise FL291 | 53.27 min | 29,228 ft (calibrated 29,102), N1 84.1% (drift −0.027/min), IAS 267.8 kt, EGT 629.2°C, FF 2,656 pph per engine, measured Mach 0.69–0.81 (FMC target 0.700) |
| Upset/descent | 0.28 min | CUTOFF → left roll −528 to −540° → pitch attitude −35.86°; FDR stops |

- Cruise altitude has one quantization code (29,227.6 ft); the apparent variation corresponds to 128.32-ft quantization noise. Recorded Mach changes from 0.69 to 0.81; `FMC_Mach` is the target value.
- The decoded Eng2 N1/N2/EGT/FF data show no step change or single-engine pattern; both engines were symmetrical.

### 4.3 Previous flight (MU5864, Chongqing ZUC → Kunming ZPP)

| Phase | Duration | Data |
|---|---|---|
| Taxi out | 2.30 min | 1,382 ft (Chongqing), N1 21% |
| Takeoff roll | 0.82 min | N1 23.1→88.5%, IAS 45→158.8 kt |
| Climb | 10.87 min | 1,382→25,635 ft, 2,347 ft/min, N1 87.9–99.6% |
| Cruise FL258 | 35.07 min | Mean altitude 25,709 ft (maximum 25,763 ft), N1 83.7%, IAS 295 kt, EGT 632.3°C |
| Descent/steps/approach | 6.28+2.20+10.00+3.33+4.72 min | Descent −980/−956 ft/min, final approach −811 ft/min, IAS 141–164 kt |
| Landing/taxi in | 0.57+5.15 min | IAS 151→45 kt / 35 s (−3.11 kt/s), peak reverse-thrust N1 76.3% |

- The combined previous-flight / accident-flight ARINC 717 data join at block 4877 (previous-flight shutdown / accident-flight start), so the Kunming turnaround is truncated. The previous flight's absolute time is represented by an upper bound.
- The MU5864 ACARS TKO report is timestamped 02:11Z (10:11 Beijing), and its recorded altitude is 3,025 ft. The report time is given to the nearest minute. Using the airport elevation and the 72.45-min ARINC 717 liftoff-to-landing duration gives an estimated liftoff at about 10:10 and landing at about 11:24 Beijing (range 11:2x–11:3x). The ground turnaround before MU5735's approximately 13:16 liftoff is therefore estimated at about 1 h 52 min. The 12:55:39 estimate uses a continuous-recording assumption; the 12:30 estimate uses a 25-min-turnaround assumption.
- The accident flight is entirely after the join point; its timeline is unaffected.

**Text description:** On the ARINC 717 block scale (about 1 s per block), blocks 0–4,876 are the preceding MU5864 flight, 4,878–9,646 are MU5735, and 4,877 is the join. The profiles compare altitude, IAS, and N1. MU5864 cruised near FL258 (25,700 ft) and MU5735 near FL291 (29,228 ft); the earlier flight’s absolute times remain estimates based on continuity assumptions.

### 4.4 Data gaps and artifacts

- U2 data loss is about 20%: 7.97-s cycle = 6.4 s valid + 1.6 s gap.
- Altitude quantization is 128.32 ft; ground IAS remains at 45 kt and Mach at 1.25. Flap is unusable because of an 8-s square-wave artifact. FMV is usable in the original-sample FDR data (34.0→2.0/1.75), while the ARINC 717-decoded FMV column is unreliable. Invalid blocks near the join point show altitude 35,066 ft and EGT 1,004°C.
- Heading changes from 355° to 0° represent a continuous turn through north. The ±27° cruise bank is recorded in the data, as are N1 variations of 35–86% during approach.
- **The +40°/−23° track swing from 06:21:25–35 is classified as a radar-degradation artifact.** The implied maneuver would require 3.3 g / 73° bank, compared with actual Nz of 0.9 g; position-difference speed is M1.06–1.14.

---

## 5. Radar and flight-path analysis

### 5.1 Radar descent

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
- Track values from 06:21:25–35 are unreliable (see §4.4).

**Text description:** Measured radar altitude falls from 8,870 m at 06:20:50 UTC to 3,380 m at 06:21:40: a mean descent rate of −109.8 m/s over 50 s, about 10.7 km horizontally, and mean groundspeed of about 850 km/h. Radar altitude is missing from 06:21:45 onward; later positions are labeled Radar Prediction. Track values for 06:21:25–35 are unreliable.

### 5.2 Flight-path reconstruction (final 20 s)

| Quantity | Result |
|---|---|
| Roll rate | −32 ± 2°/s (plateau), peak −34.2°/s; cumulative over 16.3 s **−528° to −540°** (≈1.45–1.50 revolutions) |
| Pitch rate | Mean −1.74°/s, peak −3.76°/s; pitch attitude +2.46 → −35.86° |
| Flight-path angle | 0 → −29.1° |
| Nz | **16 Hz: −0.29…+1.29 g** (FDR 1-Hz sample −0.19…+1.19; decoded ARINC 717 data at 1 Hz 0.48–1.28, with one −0.111-g sample, use a different convention); 88.5% <1 g; n=1/cosφ does not fit these samples |
| Specific energy | 11,135.9 → 10,898.0 m, net loss −238 m over 19.4 s; altitude fell 1,134 m, of which 896 m became kinetic energy (79%) |
| IAS/TAS | 265→**339.75** kt (decoded ARINC 717 final value 337.5); TAS 409.8→484.1 kt (750→897 km/h); M 0.69→0.81 |
| Descent rate | 0 → 22,700 ft/min; final 8 s average −20,800 ft/min |
| Radar lag | 06:21:00 residual −215 m; optimal shifts of −1.25/−2.25 s reduce residual to 3.8/4.6 m → radar altitude lags FDR by about 1.5–2 s |

### 5.3 Impact

- Last measured point at 06:21:40: 3,380 m, 1,010 km/h, track 115°, final vertical rate −86 m/s.
- Pure vertical extrapolation gives 06:22:12–19 and a point at 23.260°N, 111.064°E. The [CAAC's 2022-04-20 notice](http://www.caac.gov.cn/XXGK/XXGK/TZTG/202204/t20220420_212895.html) identifies **23°19′25.52″N, 111°06′44.30″E** as the main impact point. This point is **14.90 km on bearing 078.7°** from the last radar point and about **8.6 km** from the straight-line extrapolation.
- A reconstructed trajectory with a left turn of about 36° after 06:21:40 and a reduction of mean descent rate to about 61 m/s would require lateral acceleration of 0.34 g (≈19° bank).
- Track-geometry reconstruction uses 11 measured points and 10 segments: **12.82 km along track / 50 s**, mean groundspeed **923 km/h** (chord mean 853); mean descent angle **24.9°** (chord) / 23.2° (track), glide ratio **2.16:1**, equivalent to a descent of 464 m per km (about 9× a normal 3° glide path).
- The last measured point at 06:21:40 is about **17.5 km / bearing 049°** from Wuzhou Xijiang Airport, using a public airport reference coordinate. Public coordinate sources differ by about 0.6 km; the distance is approximate. The 115° extrapolated track passes no closer than about **16.1 km** from the airport. The notification form describes the aircraft as “5 km outside the airport”; this is a rough description that differs from the radar-derived geometry.
- The CAAC notice's impact point is about **8.8 km** from the airport using the same public reference coordinate. It is 8.6 km from the straight 115° extrapolation; at 1,030 km/h, that distance corresponds to about 52 s, or **06:22:32**. The reconstructed alternatives include a final track change from 115° to roughly 079°. The witness material reports a pre-impact track of 85°–95°; the CAAC notes that the witness statements conflict.
- **Estimated impact interval: 06:22:15–06:22:42Z, center about 06:22:30; position uncertainty about ±5 km and direction uncertainty about ±35°.** The coordinate is reported in the CAAC notice; the time and trajectory range are reconstructed estimates. The 06:22:14–40 witness interval falls within the estimated time range.
- The notification form's OCR text reads “5 Konts away from the Wuzhou airport.” The value is retained as an approximate description rather than a radar-derived location.

---

## 6. ACARS engine-data analysis

- **1,956 messages** (unique timestamps; CRZ 977 / TKO 979), 2021-04-13 00:54 → 2022-03-21 05:16 UTC, covering 327 days (343 calendar days, no messages for 16 days), 182 flight numbers, all B-1791 / MU / A85-27/28.
- **No fault, warning, or exceedance message types or flags appear in the released dataset**; the ACARS messages are CRZ and TKO. Observed ranges include EGT 542–978°C, N1 73.5–101.6%, gross weight 46,899–72,901 kg, and oil pressure 41–61 (unit as recorded in the dataset). Manufacturer-limit comparisons are not included here.
- Accident-flight TKO, 2022-03-21 05:16:00Z (received by GE at 05:18:05): N1 100.1/100.1%, N2 99.9/99.8%, EGT 875/869°C, FF **per engine** 3,765/3,745 kg/h, ACARS `Throttle Lever Angle` (TLA) 77.2/77.1°, Alt 7,437 ft, CAS 170, Mach 0.295, GW 66,170 kg. This ACARS field is distinct from the FDR's `Left Engine Throttle Resolver Angle` / `Right Engine Throttle Resolver Angle` parameters (TRA).
- **No cruise message is present for the accident flight**: all 31 earlier MU5735 flights on this aircraft had paired TKO+CRZ messages; the median TKO→CRZ interval was 25 min. The full released dataset contains no later messages after 05:16. It does not state whether the missing message was not downlinked, not received, or not released.
- Previous flight MU5864 (ZUC→ZPP): TKO 02:11Z, CRZ 02:34Z; preceding flight MU5863 on 03-20: 23:27/23:56.
- **Fuel-flow units**: the source has no unit label. Mass balance across 949 TKO→subsequent-message pairs supports ACARS as **kg/h per engine** (the ratio of actual fuel burn to twin-engine cruise burn is 1.61 if kg/h and 3.54 if lb/h). FDR Eng1/Eng2 Fuel Flow is **pph per engine** (two separate parameters, not total flow); accident takeoff 8,312 pph = 3,770 kg/h, within 0.13% of ACARS 3,765 kg/h.
- **Fuel estimate**: 10,100 kg at takeoff; using cruise 2,736 kg/h × 0.89 h + about 1,050 kg for climb + 300 kg taxi gives an estimated burn of about 3,800 kg and a remaining quantity of about **6,300 kg before landing**. The FDR contains no fuel-quantity parameter; the recorded engine decay was synchronous.

### 6.1 Engine health trends (1,956 messages)

- **Annual EGT trend analysis**: monthly TKO medians of 786–841°C track SAT. After adjustment for GW/SAT/sampling altitude/N1, residual σ=5.7°C (R²=0.979), annual cumulative drift **+2.4°C** (Theil–Sen +2.5°C/year, 95% CI +1.3…+3.9). Quarterly normalized EGT values range from 860.9°C to 862.7°C (1.8°C band; non-monotonic), with no material deterioration or step change in this analysis.
- By engine, Eng 1 EGT residuals are +2.4 to +3.0°C/year and Eng 2 residuals +0.2 to +2.0. Eng 1 oil pressure is 1–2 psi lower (87% TKO / 94% CRZ) and FF is higher by 15 kg/h; these differences are more consistent with **channel/sensor bias** than mechanical deterioration.
- N1/N2 trend analysis: CRZ N1 R²=0.975 σ=0.47%; N2 R²=0.991 σ=0.11%. FF–GW relationships are 81 kg/h per tonne at takeoff and 22 kg/h per tonne in cruise; median twin-engine cruise flow by altitude band is 2,585 (18–26 kft) to 2,334 (35–40 kft).
- Vibration analysis shows no monotonic increase (maximum +0.04 units/year). Two events were identified: an Eng 1 N1 TF step decrease around 2021-06-25 (permutation test p=0.007, then remained low) and an Eng 2 N1 TF transient cluster in 2021-12 (12 readings >1.0, peak 1.47, receded in January). Both patterns are more consistent with maintenance/sensor events.
- Anomaly detection identified **90 hits / 81 messages (4.1%)**; no message hit ≥3 rules. The five highest-scoring cases involved vibration spikes or FF residuals at high load. Detectable thresholds are N1 0.75%, N2 0.375%, EGT 3–6°C, and IAS 1.5 kt (≥3 s); Eng 2 N1/EGT/FF have a 40.64-min blind spot.
- **13 data-integrity anomalies** comprise 9 messages with asymmetric twin-engine EGT, N2=66, N1=98/85.5, TLA=19/61, and CRZ Alt=3,010 ft@M0.70. The affected cells are OCR damage; N1/FF/oil remain symmetrical and the next message returns to baseline. These cells are excluded before z-scoring.
- **Accident-flight comparison**: EGT1 875°C is at the raw 89.9th percentile; after matching 60 nearest samples by GW/SAT/altitude it is at the **44.2nd percentile**; in the tight match band (GW 64–68 t, SAT 18–23°C, Alt 6.5–8.5 kft, n=75) it is at the **42.0th percentile**; conditional residual **−6.1°C → 11.2th percentile**. N1 100.1% (93.7→86.7), FF 3,765 (62.5→57.5), and oil 95°C (90.3→87.5). The values are consistent with the 66.17-t weight, SAT 20.5°C, and 7,437-ft sampling point; both engines were symmetrical and values were within the previous five MU5735 takeoffs (EGT 842–876).
- **FF unit assessment: kg/h per engine**. FDR median Eng 1 flow at the same altitude band (7,000–8,000 ft, N1>99) was 8,280 pph = 3,755.7 kg/h, versus ACARS 3,765 → **+0.25%**. Interpreted as twin-engine total, the difference is −49.9%; interpreted as lb/h per engine, it is −54.5%. Cruise cross-check: ACARS FL290 band 1,234 kg/h versus FDR FL291 2,640 pph = 1,197 kg/h → **+3.0%**. For 925 mass-balance pairs (cleaned; 949 raw), actual burn 3,978 ÷ ACARS twin-engine cruise flow 2,455 = **1.61** (99.9% between 1.0–2.5); using lb/h gives 3.54 (0.2% within the stated range).

**Text description:** Across 1,956 ACARS messages (2021-04-13 to 2022-03-21), takeoff EGT trends −54 °C/year (R²=0.14, n=963) and cruise EGT −26 °C/year (R²=0.07, n=941), with strong seasonality. Cruise fuel flow rises about 12.6–13.4 kg/h per 1,000 kg of weight. The accident day has a TKO message but no CRZ message.

---

## 7. Volume 8: correspondence, briefing slides, and investigation status (`FOIA Release Records - DCA22WA102 (8).pdf`)

### 7.1 CAAC Information Exchanges, 2022-04-07

| Item | Value |
|---|---|
| Route | ZPPP LXI A599 GYA ZGGG; alternates ZGOW/ZSAM; planned 1:33 |
| Fuel | Planned 10,056 / trip 3,880 / Xiamen alternate 2,279 / CONT 650 / FINAL RES 1,300 / EXTRA 1,200 / RAMP 10,056 / **actual 10,100 kg** |
| Load | 3 flight crew + 6 cabin crew; **PAX 123**; cargo 2,288 / mail 368 / baggage 647 kg; **TOW 66,039 kg (max 68,300)**; `MACTOW` (takeoff center-of-gravity position) 20.96% MAC (allowable range 11.24–30.8% MAC) |
| Crew | Captain age 31, ATPL, **7,496:51 h**, proficiency check (PC) passed 2021-10-15, 48-hour duty 20:19, rest 12:45; F/O age 58, **34,461:08 h** (B737 19,134:13); S/O age 26, **CPL**, 744:27 h, 90-day 147:46 h; the briefing slides tentatively assign radio calls to the S/O and list cockpit seating for all three pilots as unconfirmed |
| Dispatchers | 3 (ages 27/27/31, all licensed) |
| Weather | ZPPP 210500Z 25010G16MPS CAVOK 25/00 Q1016; the source says “no severe turbulence alert or significant change” en route; **no NOTAM related to flight safety** |
| ATC | 13:15 clearance / 13:16 takeoff / 13:27 climbed and maintained 8,900 m (another entry in the same material says 13:22) / 13:35 offset / 13:41 Nanning / 14:16 Guangzhou / 14:20 steep descent + CL warning / **14:21:40 final SSR point 3,380 m, 1,010 km/h, 117.8°** |
| Witnesses | **Interviewees: 38** (38 people interviewed), observation window 14:22:14–40; the source states that “statements conflict” and records reports of a bang, roll, and pre-impact track of 85°→95° |
| Manual review | The page's only entry is “Under review.” |

### 7.2 Emails (174 messages + 4 documents, 2022-03-21 → 2024-03-21, 27 subject threads)

- Direction: CAAC→NTSB 38 / NTSB→CAAC 24 / internal NTSB 94 / third parties and public 16 (172 total; 2 more unclassified, 174 total).
- Redactions: **within vol. 8** b(5) 74 pages / b(6) 114 / either 121 (64.7% of its 187 pages); **entire release** including vol. 1 p. 34: 75/119/124.
- **CVR transfer**: on 3/24 the CAAC reported that the CSMU had been disinfected and cleaned; remote assistance occurred on 3/24–25 (Lin → Silva → Greg Smith → Mrs. YU Liling → Zoom). A recovery group was formed on 3/28, when the NTSB received the module. NTSB personnel repaired and downloaded it, rated all four channels Excellent, and returned all audio to the CAAC. This sequence documents NTSB receipt and subsequent transfer of the CVR materials.
- **2022-05-17 WSJ**: Silva told Lin that WSJ would publish a story and asked “whether the accident was the result of an intentional act.” Four consecutive b(5) redaction blocks follow the question. Lin's visible reply thanks Silva for “remembering our concerns” and discusses the May 12 Chongqing A320 rejected takeoff and runway excursion. The visible text contains no statement addressing the intentional-act question.
- **2022-04-20 preliminary report**: Lin 04:40 → Silva 07:41 “Just got this in.” → Frantz 12:16 → Silva 12:33 “Yep. As expected.” The body is withheld under b(5); the report itself is absent from the release.
- **Anniversary communications**: a progress request on 2023-01-27 received the 2023-02-08 response “I have no information to update.” On 2023-03-16, NTSB asked whether information or an interim report would be issued before the anniversary; on 2023-03-20 the response stated, “The attached is the interim statement” (attachment withheld under b(5)). On 2024-03-21, Silva's letter cited Annex 13 §§5.26/6.2 and 49 U.S.C. §1114, stated “since a final report has yet to be issued,” and asked for the “report timeframe.” Lin's visible reply thanked him and offered a video meeting; the substantive reply is withheld under b(5).
- **Aireon**: the report title is `AireonALERT Report for FLIGHT ID CES5735`; the report is fully redacted under b(5).
- **SSR**: 2022-04-09 MAO→Silva, with the attachment at pp. 180–181.
- **Items not present in the release**: no later delivery of the airline interview transcription or ADS-B data plot promised on 4/07 appears in the released records.

### 7.3 Investigation status

- The **[CAAC's 2024-03-20 second-anniversary investigation update](https://www.caac.gov.cn/PHONE/XXGK_17/XXGK/TZTG/202403/t20240320_223268.html)** states that no faults or abnormalities had been found before takeoff in the aircraft systems, airframe structure, or engines, and that the crew and maintenance personnel met qualification requirements. Among public materials located as of 2026-11-09, it is the latest substantive official update. The notice contains no cause determination or report schedule.
- The April 2026 release contains no final report. The 2024-03-21 email states that “a final report has yet to be issued.”
- Of 15 promised items, 11 were not delivered, 3 were partially delivered, and the status of 1 is unknown.
- The response ledger records 859 pages fully withheld and 314 pages partially redacted. Text redaction labels appear on 124 pages in the released files. The NTSB report states that CVR audio was returned to the CAAC.

### 7.4 CVR record and reconstructed recording windows

- The CSMU was recovered on 3/23. After unsuccessful download attempts in Beijing on 3/24–25, the Chinese team requested assistance. The NTSB received the module on 3/28 and formed a recovery group. The report states that the recovery was “performed by NTSB personnel and overseen and recorded by CAAC personnel” (p. 4).
- The initial download produced four audio tracks with the expected duration and sample rate. The tracks were **unintelligible / unusable** and were not rated (p. 5).
- In the chip-image route, 14 DLDR chip images were combined into a CHIPS `.du` file and processed in Playback32. The three audio-panel channels were rated **Fair**, and CAM **Poor**; repeated audio was present in the accident segment (pp. 9–10).
- After the case was opened, the connector repaired, and a new shell fitted, the final download had the correct sequence, with the accident at the end. All four channels were rated **Excellent** (pp. 12–13).
- The NTSB returned nine types of files to the CAAC: original download, chip images, all `.du` files, all WAV files, time-corrected and 8k→16k upsampled audio, RAPT-R `.mdf`, enhanced audio, time-stretched audio, and photographs/microscope images. The NTSB retained photographs, scans, and microscopic images (p. 14).
- **Reconstructed locations of the final approximately 70–97 seconds** (three WAV families):
  - **Family A** (reassembled in chip-write order, accident in the middle): 8-kHz audio about **48.99–50.00%** (3,527–3,600 s; based on 14-chip striping it falls in the 6/14–8/14 slots, range 42.9–57.1%); CAM about **49.32–50.00%** (5,327–5,400 s).
  - **Family B** (final Playback32, chronological order, accident at the end): 8-kHz **98.99–100.00%** (01:58:47–02:00:00, byte offset 114,032,000 @16-bit); CAM **99.32–100.00%** (02:58:47–03:00:00, 343,264,000).
- **Family C** (NTSB time-corrected/upsampled/stretched version) is estimated to cover **06:21:05–06:22:15–42Z**, based on the final FDR time and the estimated impact interval. The released materials contain neither these WAV files nor the RAPT-R session records. The actual file offset is therefore not listed in the release; packet loss also affects time alignment.
- The Family B accident segment is estimated from the file's chronological order and the accident's position at the end of the recording. The file and the actual CVR stop time are not included in the released materials. Any post-impact recording would place the accident segment earlier in the file.
- Assuming recording stopped near the estimated impact center of 06:22:30Z, the three audio-panel channels' approximately 2-hour recording window would span 04:22:30–06:22:30Z (12:22:30–14:22:30 Beijing), and the approximately 3-hour CAM recording window would span 03:22:30–06:22:30Z (11:22:30–14:22:30 Beijing). The actual stop time is not stated. The NTSB report states that the CVR battery could continue recording for at least 10 minutes after loss of aircraft-generator power; this is a minimum capability, not a maximum. The released record does not specify the actual post-impact recording duration or the recording-window start.

  The previous MU5864 ACARS TKO report is timestamped 10:11 Beijing and records 3,025 ft, about 1,643 ft above the Chongqing airport elevation in the decoded flight data, placing the report roughly 40–60 seconds after liftoff. Adding the 72.45-minute ARINC 717 flight duration gives an estimated landing around 11:24 Beijing (range 11:2x–11:3x). Under the nominal windows, CAM begins around the estimated landing and does not include the previous flight's takeoff; a later window would move further into the turnaround. The nominal audio-panel window begins during the turnaround. **The NTSB report states that the accident was captured on all four channels.** The exact file offsets are not included in the released materials.
- The NTSB report states that nine types of CVR files were provided to the CAAC delegation and that the NTSB retained only photographs, scans, and microscopic images. The FOIA package includes the report and FDR data but no CVR audio or transcript. Volume 8 also refers to China Eastern CVR maintenance and self-test records.

### 7.5 Investigation administrative timeline (2022-03-21 → 2026-04)

The review organizes 174 emails and 4 documents from Volume 8 into **99 administrative events** across 38 dates and four periods:

- **Initial response (3-21–4-07, 53 events)**: WOC notification at 05:12 → initial report at 05:19 (132 POB, local 14:22) → **Aireon report received at 05:58, before the CAAC notification form at 09:48** (CES5735) → CAAC notification form at 09:48 (B1791 / 06:30 UTC / 123+9 / IIC Lin Hang) → CAAC formal invitation on 3/24 (passports requested; the same email states “CVR has been retrieved and we hope to have your help”) → parallel activity on 3/28 (U.S. team traveled to China on DL287 / Chinese team traveled to the U.S. for FDR repair) → Investigation Protocol signed on 4/05 → operational-factors meeting on Zoom and briefing slides on 4/07.
- **Recorders and preliminary report (17 events)**: CVR CSMU recovered on 3/23 → trans-Pacific technical channel on 3/24 → recovery group and four unusable audio tracks on 3/28 → FDR CCA transfer on 4/04 (golden chassis, DLDR all zeros, U2 crack) → CVR repaired, all four channels rated Excellent, and all audio returned to CAAC → preliminary-report body withheld under b(5) on 4/20, with the report absent from the release → 33-page report dated 7/01.
- **Media and anniversaries (14 events)**: on 5/17, the WSJ “intentional act” question is followed by four b(5) redaction blocks; the CAAC's visible 03:26 reply contains no response to the question and discusses the Chongqing A320 event on 5/12. A progress request in 2023-01 received “no information to update” on 02-08. A request about an interim report on 03-16 was followed by the 03-20 interim statement (body redacted under b(5), attachment withheld). Seven anniversary-strategy emails on 03-21 are redacted under b(5).
- **Second anniversary and FOIA (15 events)**: the 2024-03-21 04:52 letter cites Annex 13 filed differences, §1114(f), “final report has yet to be issued,” FOIA risk, and flight-data sensitivity, and asks for a report timeframe. Lin's visible 07:41 reply offers a video meeting; the substantive reply is withheld under b(5). Two FOIA requests followed in 2026-01, with a response in 2026-04.

**Five documented areas of incomplete records**: G1 preliminary report (4/20, body withheld under b(5), report absent); G2 interim statement and anniversary strategy (2023-03-20/21); G3 response to the WSJ “intentional act” question; G4 report schedule (multiple requests; substantive response withheld); G5 promised items and the full record (15-item ledger, 11 undelivered; 2024-03-20 letter body missing; 859 pages fully withheld; 190-page difference between 314 and 124).

**Text description:** The 99 investigation-administration events fall into seven categories. Delivery status: 25 delivered, 9 partial, 3 promised only, 26 submitted but withheld, 10 declined or unanswered, 7 requested with no record, and 19 with no responsive object. G1–G5 summarize gaps involving the preliminary report, anniversary documents, the WSJ question, report timing, and 15 promises plus the complete record.

---

## 8. Documented discrepancies and released-data status

| # | Documented discrepancy | Record summary |
|---|---|---|
| C01 | CVR receipt and return | NTSB received and downloaded the recorder, returned the audio to CAAC, and retained no audio. |
| C02 | Recorded times: 06:30 / 06:21:40 / 06:22:30 | The notification form gives an approximate time of 06:30; 06:21:40 is the last radar point; impact time is estimated at about 06:22:30. |
| C04 | FDR stop altitude: 26,000 / 25,389 / 25,506 | The NTSB report gives an approximate altitude; the last valid measured FDR value is 25,389 ft. |
| C06 | ARINC 717 time bases differ by 1.385× | The previous-flight data are uncorrected; absolute synchronization uses the corrected combined-flight data. |
| C07 | CVR ratings: Fair/Poor and Excellent | The first download was unusable; the chip-image download was rated Fair/Poor; after connector and shell work, the final download was rated Excellent. |
| C09 | FOIA totals: 478/122 and 859/314 | 478/122 covers b(5) only; the overall ledger records 859 pages fully withheld and 314 partially redacted. |
| C12 | FDR stop times: 14:20:51 / 14:21:04 / 14:21:05 | The estimated interval is 14:21:04–07. |
| C13 | Impact-time estimates: 14:22:05 / 14:22:18 / 14:22:30 | The estimated center is 14:22:30 ±10 s. |
| C14 | FIRE entries: 1 and 213 | The 213 entries are 8-second artifacts; valid data contain 1,336 NO FIRE entries, with the only FIRE entry in the final bad frame. |
| C15 | ACARS FF units: kg/h per engine / lb/h per engine / total flow | Mass-balance analysis supports **kg/h per engine**; FDR records pph per engine. |
| C17 | Cruise altitude: 8,900 m / 29,227.6 ft | 29,227.6 − 125.6 = 29,102 ft = 8,870 m; CAAC's 8,900 m is rounded. |
| C18 | Witness track: 85°–95° / radar track: 115° | The witness statements are conflicting; the reported 85°–95° track is a range, while radar records 115°. |
| C22 | AP disconnect times differ by 1.5 s between summary grid and original-sample data | Original-sample data place AP-1/AP-2 warnings at 288960.43 and AP disconnect at 288960.80. |

**Additional recorded observations and release status**: ① the calculated descent rate changes from 158 m/s to 44 m/s between 06:21:25 and 06:21:30; ② the FOIA release contains the recorder report and FDR data; ③ the accident flight has no CRZ message in the ACARS dataset; ④ the FDR counter records 80.27 h; ⑤ the 06:21:25–35 radar track is classified as degraded.

---

## 9. Summary of findings and analysis

- The FDR fields `Eng1 Cutoff SW` and `Eng2 Cutoff SW` changed to CUTOFF, and recorded `Left Control Wheel Position` varied from −19° to −102°. Related recorded parameters changed during the same interval. The aircraft rolled left about 1.45 revolutions as pitch attitude reached −35.86°. The FDR powered down after aircraft-generator power loss; it had no battery backup. Radar recorded a descent rate of 21,600 ft/min.
- Investigation status: the CAAC is the lead authority. The April 2026 NTSB release contains no final report; the 2024-03-21 email states that “a final report has yet to be issued.”
- The 737NG fuel control switch has a **locking feature** intended to prevent inadvertent movement. FAA [SAIB NM-18-33](https://drs.faa.gov/browse/excelExternalWindow/BBE820D0419DB3358625836600761396.0001) says that when the feature is engaged, the pilot must lift the switch while transitioning it; when disengaged, the switch can be transitioned without lifting.
- **Sensitivity analysis**: the analysis classifies 10 principal findings as **5 robust, 4 moderate, and 1 fragile**. The most robust results are synchronized engine decay, the recorded hydraulic-pressure and fire-warning parameters, and the engine cutoff-switch changes (16 continuous CUTOFF values in the original-sample data, independently supported by the engine-decay onset). Impact geometry is the most sensitive reconstruction because it depends on the main impact point published in the CAAC notice. Rudder-pedal position, cumulative roll, and attribution of recorded changes are rated moderate; the direction finding is rated robust.

---

## Appendix A: Supplemental results in text

| Topic | Result | Convention / note |
|---|---|---|
| Accident timeline | CUTOFF 14:20:48; FDR stopped about 14:21:05; estimated impact about 14:22:30 (14:22:15–42) | Impact time is inferred; 14:22:18 is only the pure vertical-extrapolation alternative |
| Final FDR sample | 25,389 ft, 339.75 kt, pitch −35.86°, unwrapped roll −527.9° | 8-Hz full-window integration gives −540.4°; these are different measures |
| Radar descent | Altitude fell from 8,870 m to 3,380 m between 06:20:50 and 06:21:40 | No measured radar altitude is available for 06:21:45–55; those values are predictions |
| Two-flight profile | Altitude, IAS, and N1 compared using ARINC 717 data | The previous flight's absolute time is uncertain because of the splice gap |
| Engine trend | Raw ACARS EGT slopes are seasonally affected; adjusted annual cumulative trend is +2.4°C | Raw slopes and adjusted trend use different statistical methods |
| Investigation record | 99 administrative events in 7 categories, 7 delivery statuses, and gaps G1–G5 | Organized from the released emails and documents |
