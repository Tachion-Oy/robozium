"""Build a mounted local skill through the live application without providers."""

from roboz.models import Empty

from robozium.api.app import live_app
from robozium.hub.utils import load_hub


def main() -> None:
    app = live_app()
    try:
        hub = load_hub()
        label = next(label for label in hub.capabilities() if label.name == "local_example")
        assert label.kind == "skill" and label.selectable
        project = hub.project("local-capability-check")
        definition = hub.configure_deployment(
            project.sandbox, project.slug, endpoint_getter=lambda: hub.default_model
        )
        definition.set_capability_selection({"local_example": True})
        agent, _ = definition.build()
        assert agent.skills is not None
        skill = next(skill for skill in agent.skills if skill.name == "local_example")
        assert skill.tools[0](Empty(), []).project == project.slug
        definition.set_capability_selection({})
        agent, _ = definition.build()
        assert all(skill.name != "local_example" for skill in agent.skills or ())
    finally:
        app.state.run_manager.shutdown()
    print("Mounted local skill loads and builds through the live application.")


if __name__ == "__main__":
    main()
