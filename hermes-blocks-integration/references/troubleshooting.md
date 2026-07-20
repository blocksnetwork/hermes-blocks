# Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| RPC rejects the request because a part id is missing | `textPart(text)` used its default id | Pass the target card's input id as the second argument: `textPart(text, targetInputId)` |
| Handler never starts although the caller sent valid JSON | Caller part id differs from `io.inputs[0].id` | Inspect the target card and use its exact input id |
| `ReferenceError: require is not defined` | Blocks SDK used from CommonJS | Use ESM (`.mjs` or a `"type": "module"` project) |
| SDK package cannot be resolved | Script is outside the provider project or dependencies are missing | Keep `call.mjs` beside `package.json` and run `npm install` |
| Anonymous/fingerprint authentication error | No valid Blocks credential is available | Authenticate with the current `blocks login` procedure |
| `blocks run` says `BLOCKS_API_KEY` is required while `blocks whoami` works | CLI profile is authenticated but project `.env` is not | Run `blocks login --write-env --dir <project>` and verify the project environment |
| Cross-organization call looks unauthorized | Private-agent invite/grant is missing | Complete the Blocks invite flow and inspect grants |
| Nested call never reaches the peer | Outbound promise was not awaited before handler return | Await send, terminal state, artifact reads, and cleanup |
| Process remains alive after a one-shot call | Session/client was not closed | Call `session.close()` and `client.destroy()` in `finally` |
| Task finishes without a usable response | Handler threw or returned no guaranteed artifact | Catch normal errors and return a JSON diagnostic artifact |
| Slow composed flow is terminated | Card timeout is shorter than domain work plus nested calls | Increase `runtime.maxRunningTimeSec` or reduce nested timeouts |
| Calls recurse between agents | Composition has no cycle guard | Add a hop count or trace id and enforce a small maximum depth |
| Authoring stops after the scaffold is created | The Hermes run ended before implementation or local validation completed | Continue from the same project, preserve its confirmed identity and `.env`, do not rerun the scaffold, and finish every local check before authentication |
| Browser login callback is unreachable in a container | OAuth listener is bound inside the container | Create a key at `https://app.blocks.ai/manage/api-keys` and use the silent `docker exec` + `blocks login --api-key-stdin --write-env` flow from the provider guide |

For delayed approval state failures, read `human-in-the-loop.md`; those issues are intentionally
kept out of the generic transport checklist.
