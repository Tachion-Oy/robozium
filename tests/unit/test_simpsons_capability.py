"""The disabled local example can be enabled without changing application code."""

import shutil
import subprocess
from pathlib import Path

from config_support import write_config
from fastapi.testclient import TestClient
from roboz import Agent
from roboz.examples.simple import get_quote
from roboz.examples.simpsons_quotes import QUOTES
from roboz.llm import MockLLMEndpoint

from robozium.api.app import create_app
from robozium.hub.utils import load_hub

ROOT = Path(__file__).resolve().parents[2]


def test_commented_template_adds_nothing(tmp_path):
    config = write_config(tmp_path)
    local = tmp_path / "local"
    local.mkdir()
    shutil.copy2(ROOT / "examples/local-registration.py", local / "__init__.py")
    assert load_hub(config_file=config).additional_capabilities == ()


def test_enabled_example_selects_roboz_quote_tool_and_returns_its_result(tmp_path):
    config = write_config(tmp_path)
    local = tmp_path / "local"
    local.mkdir()
    source = (ROOT / "examples/local-registration.py").read_text()
    (local / "__init__.py").write_text(
        source.replace("# from .simpsons", "from .simpsons")
        .replace("# SIMPSONS,", "SIMPSONS,")
    )
    shutil.copy2(ROOT / "local/simpsons.py", local / "simpsons.py")
    hub = load_hub(config_file=config)
    app = create_app(deployment=hub)
    try:
        catalog = TestClient(app).get("/capabilities").json()
        assert {
            "name": "simpsons_quotes", "kind": "tool",
            "selectable": True, "loading": None,
        } in catalog
        capability, = hub.additional_capabilities
        definition = hub.configure_deployment(
            hub.project("demo").sandbox, "demo", endpoint_getter=lambda: hub.default_model
        )
        definition.set_capability_selection({})
        root, _ = definition.build()
        assert "get_quote" not in {tool.name for tool in root.tools}
        definition.set_capability_selection({"simpsons_quotes": True})
        root, _ = definition.build()
        quote_tool = next(tool for tool in root.tools if tool.name == "get_quote")
        assert quote_tool.caller is get_quote.caller
        agent = Agent(
            name="quote_test",
            system_prompt="Return a Simpsons quote.",
            agent_endpoint=MockLLMEndpoint([
                {"action": "get_quote", "rationale": "A quote was requested"},
            ]),
            tools=(quote_tool,),
        )
        result, _ = agent.invoke()
        assert result.value in QUOTES
        assert capability.label.selectable is True
    finally:
        app.state.run_manager.shutdown()


def test_git_tracks_only_the_shipped_local_example():
    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "local/__init__.py", "local/private.py", "local/custom/skill.py", "local/simpsons.py"],
        cwd=ROOT, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0
    assert result.stdout.splitlines() == ["local/__init__.py", "local/private.py", "local/custom/skill.py"]
