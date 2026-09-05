"""Live FastAPI CLI entrypoint; imported only when live mode is selected."""

from robosprawl.api.app import live_app

app = live_app()
