"""Unit coverage for process-local orchestrator model routing."""

from roboz.llm import LLMEndpoint
from roboz.tooling import ExternalDependencyKind, LazyExternalDependency

from robosprawl.deployment import OrchestratorModelSelector


def _lazy_model(
    name: str,
    resolutions: list[str],
) -> LazyExternalDependency[LLMEndpoint]:
    dependency_id = f"model:test:{name}"

    def resolve() -> LLMEndpoint:
        resolutions.append(name)
        return LLMEndpoint(
            client=object(),
            api_name="test",
            model_name=name,
            max_context_tokens=1_000,
        )

    return LazyExternalDependency(
        dependency_id_value=dependency_id,
        dependency_kind=ExternalDependencyKind.MODEL_ENDPOINT,
        metadata={
            "api_name": "test",
            "model_name": name,
            "endpoint_type": "llm",
        },
        resolver=resolve,
    )


def test_listing_and_selecting_do_not_materialize_models() -> None:
    resolutions: list[str] = []
    first = _lazy_model("first", resolutions)
    second = _lazy_model("second", resolutions)
    selector = OrchestratorModelSelector(
        {"First": first, "Second": second},
        default=first,
    )

    assert [model.dependency_id for model in selector.models.values()] == [
        first.dependency_id,
        second.dependency_id,
    ]
    selector.select(second.dependency_id)

    assert selector.selected_model_id == second.dependency_id
    assert resolutions == []


def test_selected_endpoint_tracks_the_latest_selection() -> None:
    resolutions: list[str] = []
    first = _lazy_model("first", resolutions)
    second = _lazy_model("second", resolutions)
    selector = OrchestratorModelSelector(
        {"First": first, "Second": second},
        default=first,
    )

    assert selector.selected_endpoint is first
    selector.select(second.dependency_id)

    assert selector.selected_endpoint is second
    assert resolutions == []


def test_unknown_model_does_not_change_selection() -> None:
    resolutions: list[str] = []
    endpoint = _lazy_model("first", resolutions)
    selector = OrchestratorModelSelector(
        {"First": endpoint},
        default=endpoint,
    )

    try:
        selector.select("model:test:missing")
    except KeyError:
        pass
    else:
        raise AssertionError("unknown selection should fail")

    assert selector.selected_model_id == endpoint.dependency_id
    assert resolutions == []


def test_route_reads_getter_once_and_keeps_live_discovery_and_clients() -> None:
    from roboz import Agent, Ctx, Empty, Message, factory
    from roboz.llm import resolve_endpoint, with_request_options

    from robosprawl.dependency_contract import DependencyRegistration, bind_dependencies
    from robosprawl.deployment import OrchestratorEndpointRoute

    resolutions: list[str] = []
    first, second = _lazy_model('first', resolutions), _lazy_model('second', resolutions)
    reads = []
    selected = first
    checks = []

    def getter():
        reads.append(selected)
        return selected

    route = OrchestratorEndpointRoute(getter)
    configured = with_request_options(route, extra_body={})
    ctx = Ctx(endpoint=configured)

    @factory
    def use_route(input: Empty, messages: list[Message], ctx: Ctx) -> Empty:
        resolve_endpoint(ctx.endpoint)
        return input

    bound = use_route(ctx)
    copied = bound.copy()
    agent = Agent(name='route_test', system_prompt='Stop.', agent_endpoint=configured)
    assert reads == resolutions == []
    clients = []
    registrations = [DependencyRegistration(d.dependency_id, d.kind, checks.append) for d in (first, second)]
    for selected in (first, second, first):
        for inspect in (route.external_dependencies, ctx.external_dependencies, lambda: bound.external_dependencies, lambda: copied.external_dependencies, agent.external_dependencies):
            reads.clear()
            assert inspect() == (selected,)
            assert reads == [selected]
        before = list(resolutions)
        catalog = bind_dependencies((*ctx.external_dependencies(), first, second), registrations)
        assert {item.dependency.dependency_id for item in catalog} == {first.dependency_id, second.dependency_id}
        assert resolutions == before
        reads.clear()
        clients.append(configured.materialize().client)
        assert reads == [selected]
    assert clients[0] is clients[2]
    assert resolutions == ['first', 'second']
    assert checks == []
