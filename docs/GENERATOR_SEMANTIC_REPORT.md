# R3 Generator Semantic Report

## Unified input and output

- Public core: `generator.codegen.generate_project()`.
- Both `/api/preview` and `/api/export.zip` call the same public core.
- The ZIP response is built in memory; Web mode does not write staging.
- Output is deterministic: no generation timestamp is embedded.
- A missing module remains `null`/unconfigured and does not create a fake
  peripheral initialization file.

## ePWM semantics verified

| Input | Expected generated meaning |
|---|---|
| `120000 Hz`, up/down, `TBCLK=60 MHz` | `TBPRD=250` |
| Duty `0.45`, CAU set / CAD clear | `CMPA=138` (`250 × (1-0.45)`, rounded) |
| RED `180 ns` | `DBRED=11` at 60 MHz |
| FED `220 ns` | `DBFED=13` at 60 MHz |
| Complementary A/B | A owns AQ; B is derived through dead-band |
| TZ1 one-shot | `OSHT1=1`, both `TZCTL.TZA/TZB=2` (force low) |

The generated release function is deliberately not called by
`Generated_InitAll()`. PWM outputs stay clamped until the application makes an
explicit release decision.

## I2C semantics verified

For `SCLA -> Pin34/GPIO29/MUX2`:

- `GPAMUX2.bit.GPIO29 = 2U`
- `GPAPUD.bit.GPIO29 = 0U` (internal pull-up enabled)
- `GPAQSEL2.bit.GPIO29 = 3U` (asynchronous qualification)
- generated comment requires external board pull-up resistors

## Gates executed

- Unit and semantic tests: 50 total, 49 passed, 1 legacy skip.
- Preview/ZIP byte identity: passed.
- TI `cl2000.exe` compile and link: six R3 scenarios, zero errors.
- Real browser: ePWM atomic group, persistence, draft cancel, I2C, validation,
  ZIP download and generated-code inspection.
