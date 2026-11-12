# web pvp

web pvp is a browser-based reconstruction of arena combat from the North American 2016 Elsword client. The current roster covers twelve professions across Elsword, Raven, Elesis and Add. Players can practice locally and join online rooms. The combat runtime can also replay input without a browser.

## Run a development server

Use Node.js 24 and pnpm 10. Run commands from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

The development server listens on `http://127.0.0.1:4196` by default. A playable session also requires prepared game resources and native modules in `artifacts/`. The repository contains the source code, converters and configuration contracts. Supply your own authorized game inputs or a compatible prepared resource tree. The web bundle alone cannot supply models, maps, audio or native modules. See the [source guide](docs/SOURCES.md) and [native build guide](docs/NATIVE_SOURCE_ROUTE.md).

## Connect to your server

Open the deployed server's URL to play in a browser. The browser uses that origin for login, rooms and battle traffic. For the Windows desktop and portable clients, put `server-config.json` beside `web pvp.exe` or `Start-Client.bat`. Set the URL to your own server.

```json
{"serverUrl": "https://pvp.example.org"}
```

You can also set `WEB_PVP_SERVER_URL` before starting a packaged client. The same setting covers login, update checks and match traffic. See [server setup](docs/PUBLIC_ONLINE.md), the [desktop guide](docs/DESKTOP_CLIENT.md) and the [portable guide](docs/LOCAL_CLIENT.md).

## Develop and verify

The [project layout](docs/PROJECT_LAYOUT.md) lists the entry points. The [development plan](docs/DEVELOPMENT_PLAN.md) explains the evidence required for a fidelity claim. The [profession guide](docs/ADDING_PROFESSIONS.md) covers IDs, shared executors, display data and regression checks.

Current guides:

- [Source inputs and evidence](docs/SOURCES.md) and [native modules](docs/NATIVE_SOURCE_ROUTE.md)
- [Server setup](docs/PUBLIC_ONLINE.md), [online combat and peer transport](docs/ONLINE_NETWORK.md), and [network measurement](docs/NETWORK2016_MEASUREMENT.md)
- [Desktop client](docs/DESKTOP_CLIENT.md) and [portable client](docs/LOCAL_CLIENT.md), including their player guides
- [PvP attributes](docs/PVP_ATTRIBUTES.md), [respawn resources](docs/PVP_RESOURCES.md), and [Lord Knight](docs/LORD_KNIGHT.md)
- [Minimal input and movement runtime](docs/MINIMAL_RUNTIME_EXPERIMENT.md)

```sh
pnpm run test:source
```

This command checks the tracked files and runs headless combat, English skill text, desktop, update, proxy and account-role tests using local fixtures. The file scan covers private inputs, credentials files, absolute home directories and untranslated player text. The broader `pnpm test` suite includes integration and source checks that read separately supplied game resources or reference evidence. Run those suites with their matching inputs. A successful web simulation establishes the behavior of this implementation. Original-client fidelity requires a separate target-client trace.

## License

Project-owned code is licensed under the [MIT License](LICENSE). Third-party components retain their own license notices. Game resources and reference inputs must be obtained separately under their applicable terms.
