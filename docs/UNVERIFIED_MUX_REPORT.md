# Unverified / Pinmux-only MUX Report

No signal-availability or numeric-MUX evidence gaps remain in the current F28034 PN80 database.

The following options are intentionally pinmux-only: they can be saved and their GPIO mux/electrical profile can be generated, but R3 does not generate complete peripheral register initialization.

| Key | Profile |
|---|---|
| `1:22:1:EQEP1S` | eqep_input |
| `1:22:2:LINTXA` | none |
| `2:32:3:ADCSOCAO` | none |
| `3:33:3:ADCSOCBO` | none |
| `4:23:1:EQEP1I` | eqep_input |
| `4:23:2:LINRXA` | none |
| `5:42:1:COMP1OUT` | none |
| `6:43:1:COMP2OUT` | none |
| `31:27:1:HRCAP2` | none |
| `31:27:2:SPISTEBn` | spi_output |
| `32:31:1:CANTXA` | none |
| `33:30:1:CANRXA` | none |
| `34:29:1:SCITXDA` | sci_tx |
| `37:26:1:HRCAP1` | none |
| `37:26:2:SPICLKB` | spi_output |
| `39:9:2:LINTXA` | none |
| `39:9:3:HRCAP1` | none |
| `40:28:1:SCIRXDA` | sci_rx |
| `41:18:1:SPICLKA` | spi_output |
| `41:18:2:LINTXA` | none |
| `41:18:3:XCLKOUT` | none |
| `42:17:1:SPISOMIA` | spi_input |
| `43:8:2:ADCSOCAO` | none |
| `44:25:1:SPISOMIB` | spi_input |
| `46:16:1:SPISIMOA` | spi_input |
| `47:12:2:SCITXDA` | sci_tx |
| `47:12:3:SPISIMOB` | spi_input |
| `49:7:2:SCIRXDA` | sci_rx |
| `55:19:1:SPISTEAn` | spi_output |
| `55:19:2:LINRXA` | none |
| `55:19:3:ECAP1` | none |
| `57:38:1:TCK` | none |
| `58:37:1:TDO` | none |
| `59:35:1:TDI` | none |
| `60:36:1:TMS` | none |
| `61:11:2:LINRXA` | none |
| `61:11:3:HRCAP2` | none |
| `62:5:2:SPISIMOA` | spi_input |
| `62:5:3:ECAP1` | none |
| `65:10:2:ADCSOCBO` | none |
| `66:3:2:SPISOMIA` | spi_input |
| `66:3:3:COMP2OUT` | none |
| `68:1:2:COMP1OUT` | none |
| `74:34:1:COMP2OUT` | none |
| `74:34:2:COMP3OUT` | none |
| `75:15:2:LINRXA` | none |
| `75:15:3:SPISTEBn` | spi_output |
| `76:13:2:SPISOMIB` | spi_input |
| `77:14:2:LINTXA` | none |
| `77:14:3:SPICLKB` | spi_output |
| `78:20:1:EQEP1A` | eqep_input |
| `78:20:2:COMP1OUT` | none |
| `79:21:1:EQEP1B` | eqep_input |
| `79:21:2:COMP2OUT` | none |
| `80:24:1:ECAP1` | none |
| `80:24:2:SPISIMOB` | spi_input |
