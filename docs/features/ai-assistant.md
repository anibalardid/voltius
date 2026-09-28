# AI assistant

**Status: Planned.** The assistant is deliberately not implemented yet. It
would combine model providers with terminal context, command execution, and
secrets, so it needs stronger privacy, prompt-injection, approval, and
third-party-provider boundaries than the current MCP and terminal surfaces
provide.

## Architecture direction

Use a provider-neutral orchestration layer with these explicit seams:

1. **Context policy** selects the active session, host metadata, terminal
   output, selection, and files, then redacts or excludes data according to
   user settings.
2. **Provider adapter** exposes one contract for a local model first and
   optional remote providers later. Provider credentials belong in the platform
   secure store, not in terminal settings, prompts, logs, or sync.
3. **Read-only tool registry** starts with bounded inspection tools. Tool
   results are labeled as untrusted data and are not instructions.
4. **Action planner** produces a structured command/action proposal with target,
   arguments, expected effect, and risk summary.
5. **Approval executor** requires a separate per-action user decision before
   any mutating tool or terminal action runs.
6. **Audit sink** records provider, context classes, proposed action, approval
   decision, target, and result without storing secrets or unnecessary output.

Local-first means the initial path can operate without a remote provider or
account when a supported local model is configured. Remote providers are
optional, explicitly selected, and never receive context merely because they
are configured.

## Safety and privacy rules

- Start read-only: inspect bounded terminal output, command blocks, host
  metadata, or selected text only when the user chose that context.
- Render every command or action in a preview showing the exact target and
  payload. Require one approval for each action; no silent execution,
  auto-approval, or approval of an opaque batch.
- Provide independent controls for secrets, host metadata, terminal output,
  selected text, files, and command history. Safe defaults exclude secrets and
  private-key/vault material. Redaction is defense in depth, not permission to
  send sensitive data by default.
- Treat terminal output, remote files, errors, and tool results as untrusted
  data. Keep them separate from system/developer instructions, label their
  source in the UI, and never allow text in them to grant tools, change policy,
  or approve an action.
- Limit context by session/host and size. Show what will leave the device
  before a remote-provider request. Keep provider failures and timeouts from
  changing terminal behavior.
- Audit approvals and executions locally with configurable retention. Do not
  put prompts, private keys, passphrases, or raw sensitive output in audit
  records unless a future explicit, reviewed setting permits it.

## Entry points to evaluate

The product decision should evaluate the same assistant contract in each of
these surfaces rather than creating separate execution semantics:

- terminal side panel for ongoing session context;
- command palette for global discovery;
- selection/context action for a user-selected command or output;
- error action for explaining or safely remediating a visible failure; and
- settings/provider page for model, privacy, approval, and audit controls.

Every entry point must show its context scope and lead to the same preview and
per-action approval flow. A surface may be deferred if it cannot make those
boundaries clear.

## Configuration

The first settings design should cover:

- local model availability and selected provider/model;
- optional remote-provider enablement, endpoint, account/key status, and data
  residency/cost warning;
- independent context toggles for secrets, host data, terminal output,
  selection, files, and local history;
- maximum context size, timeout, retention, and audit-clearing controls;
- allowed host/session scope and whether read-only tools are enabled; and
- approval behavior, with per-action approval fixed on for mutating actions.

Configuration changes should be local and explicit. They must not grant access
to private keys, vault contents, or all hosts by default.

## Acceptance criteria

- [ ] A configured local provider can answer a read-only request without a
      remote provider or account; provider adapters share one contract.
- [ ] Remote-provider requests show provider, context classes, redactions, and
      destination before data leaves the device.
- [ ] Every mutating action has an exact preview, target, attribution, and
      separate approval; denial and cancellation are terminal outcomes.
- [ ] Terminal output and remote content cannot inject instructions, grant
      tools, alter privacy settings, or approve actions. Injection fixtures are
      covered by tests.
- [ ] Secrets, private keys, vault contents, host data, output, and history are
      independently controllable and absent by default where not needed.
- [ ] Audit entries cover request, provider, context scope, proposal, approval,
      execution, denial, failure, and cancellation without sensitive payloads.
- [ ] Side panel, command palette, selection/context, error action, and
      settings entry points either share the contract or are explicitly marked
      deferred; none bypasses preview and approval.
- [ ] Provider outage, malformed model output, timeout, and tool failure leave
      the terminal and host connection unaffected.
