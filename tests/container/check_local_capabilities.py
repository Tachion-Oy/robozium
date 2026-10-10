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
        project = hub.project("local-capability-check")
        for name in ("simpsons_quotes", "simpsons_quotes_skill", "customer_quotes", "customer_guide"):
            label = labels[name]
            assert label.selectable
            if isinstance(label, SkillLabel):
                assert label.loading == SkillLoading.ON_DEMAND
            definition = hub.configure_deployment(
                project.sandbox, project.slug, endpoint_getter=lambda: hub.settings.default_model
            )
            definition.set_capability_selection({name: True})
            responses = []
            if isinstance(label, SkillLabel):
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
            assert not any(tool.name == f"get_{name}" for tool in excluded.tools)
    finally:
        app.state.run_manager.shutdown()
    print("Mounted CLI-generated tools and skills execute through the live deployment.")


if __name__ == "__main__":
    main()
