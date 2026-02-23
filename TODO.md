# TODO — `joda_ai_jarvis_control/joda_ai/`

Prompt: “use browser use / capture box so the AI agent can browse the web and solve tasks”.

## Now (done)

- [x] Fix `prompt_web_agent` to call `audio_loop.handle_web_agent_request()` (the correct async entrypoint) instead of a non-existent `web_agent.run()`.

## Next

- [ ] Add a UI “capture box” overlay to `BrowserWindow` (draw rectangle over the streamed screenshot) and send the selected region to the backend as context for follow-up steps.
- [ ] Add a “web agent busy” guard/queue so repeated prompts don’t spawn overlapping Playwright sessions.
- [ ] Add a short developer note in `README.md` describing how to run the web agent in headless mode and where screenshots/logs stream.

