"""Execute CLI-generated mounted capabilities through the live recipe."""

from roboz.deployment import SkillLabel, SkillLoading
from roboz.examples.simpsons_quotes import QUOTES
from roboz.llm import MockLLMEndpoint

from robozium.api.app import live_app


def main() -> None:
    app = live_app()
    try:
        hub = app.state.hub
        labels = {label.name: label for label in hub.capabilities()}
        assert labels["simpsons_quotes"].selectable
        skill = labels["simpsons_quotes_skill"]
        assert isinstance(skill, SkillLabel) and skill.selectable
        assert skill.loading == SkillLoading.ON_DEMAND
        project = hub.project("local-capability-check")
        for name in ("simpsons_quotes", "simpsons_quotes_skill"):
            definition = hub.configure_deployment(
                project.sandbox, project.slug, endpoint_getter=lambda: hub.settings.default_model
            )
            definition.set_capability_selection({name: True})
            responses = []
            if name.endswith("_skill"):
                responses.append({"action": name, "rationale": "load generated skill"})
            responses.append({"action": f"get_{name}", "rationale": "check generated tool"})
            definition.set_agent_endpoint(MockLLMEndpoint(responses))
            agent, _ = definition.build()
            agent = agent.copy(default_tools=tuple(
                tool for tool in agent.default_tools
                if not tool.name.startswith("start_background_agent_")
            ))
            assert agent.invoke()[0].value in QUOTES
            definition.set_capability_selection({})
            excluded, _ = definition.build()
            assert not excluded.skills
            assert not any(tool.name.startswith("get_simpsons") for tool in excluded.tools)
    finally:
        app.state.run_manager.shutdown()
    print("Mounted CLI-generated tools and skills execute through the live deployment.")


if __name__ == "__main__":
    main()
