# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-31

### Added

- **status:** report approval waits to Herdr and OSC 7501 ([5009feb](https://github.com/sqwxl/pi-guards/commit/5009febb7c2cc836e623ac71c9af6eb783fde664))

### Fixed

- **confirm-writes:** resize the approval prompt with the window ([aae7915](https://github.com/sqwxl/pi-guards/commit/aae7915bf65c060c7b2ee1744fd71cdb79c46a93))
- **confirm-writes:** label the relax option by its real effect ([118d43f](https://github.com/sqwxl/pi-guards/commit/118d43fa41006a286a0ff1a7b57594d59b484e57))

## [0.2.0] - 2026-10-25

### Added

- **permission-gate:** ask before every process kill in CAREFUL ([3fe06ab](https://github.com/sqwxl/pi-guards/commit/3fe06ab9e4825c5fb0f1dc32a4a2e561cfaaeaa6))
- **confirm-writes:** show the call payload in an overlay approval prompt ([0dd39b9](https://github.com/sqwxl/pi-guards/commit/0dd39b93cea828c9d291ee3b26d41b5023f2b2e5))
- **permission-gate:** ask before deletions outside scratch roots ([c590709](https://github.com/sqwxl/pi-guards/commit/c5907098b51921dca2e0e613e963952dd8016bb8))
- harden destructive-command checks and fix approval prompt footguns ([58db8e5](https://github.com/sqwxl/pi-guards/commit/58db8e563deea3d0d655814f9397e58e2559f1c6))
- publish package, persist modes, and harden guards ([2f00d7e](https://github.com/sqwxl/pi-guards/commit/2f00d7ee27977981d7034778b672b354c3d7e594))
- **confirm-writes:** start in CAREFUL and relax the mode from the approval prompt ([972ab72](https://github.com/sqwxl/pi-guards/commit/972ab728f537d9544ad0ac939a2dff39875da4ba))
- **confirm-writes:** paint the mode status background with contrast text ([b856f36](https://github.com/sqwxl/pi-guards/commit/b856f36872595c5a70674eb5fe1b759bd8ce9495))
- add PARANOID, CAREFUL, and YOLO approval modes ([f346f14](https://github.com/sqwxl/pi-guards/commit/f346f14eaa4b86bc9880e042fc1dd2d0125b9035))
- add pi write guards as a pi package ([e85fd38](https://github.com/sqwxl/pi-guards/commit/e85fd388c544e431c7a472bceeb04562c6a735eb))

### Fixed

- **confirm-writes:** keep shift+tab working in approval dialogs ([62724dc](https://github.com/sqwxl/pi-guards/commit/62724dc7a469a086a3c5653cf017cb7a22664706))
- **confirm-writes:** handle ctrl+o in the write approval prompt ([3158dba](https://github.com/sqwxl/pi-guards/commit/3158dba941ec03dc02f2b467ca90f6562a6e7761))

[0.3.0]: https://github.com/sqwxl/pi-guards/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sqwxl/pi-guards/releases/tag/v0.2.0
