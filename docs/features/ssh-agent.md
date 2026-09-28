# Built-in SSH agent

**Status: Planned.** Voltius already supports forwarding the operating
system's SSH agent; that is not a built-in Voltius agent. A built-in agent is
deliberately not implemented yet because private-key handling, local IPC,
remote signature requests, and platform key/FIDO2 boundaries need a stronger
security design.

## Existing forwarding versus the future agent

| Capability | Existing OS-agent forwarding | Future built-in Voltius agent |
| --- | --- | --- |
| Private keys | Remain in the operating system agent; Voltius proxies requests | Managed behind a Voltius signing boundary; private-key material is never sent to a remote host or exposed through the agent protocol |
| Remote risk | A trusted remote can request signatures from the forwarded OS agent | Every request passes destination policy and the Voltius confirmation path |
| IPC | Uses the platform's existing agent endpoint | Uses a per-user, owner-only local socket or pipe |
| Product status | Implemented and must remain separate | Planned; must not silently replace or broaden forwarding |

Forwarding is therefore a per-host trust decision. A remote host that can use
the forwarded OS agent may ask it to sign data even though it cannot read the
private key. The UI must keep that risk visible.

## First built-in-agent contract

- Keep private keys local. The signing API accepts a request and returns a
  signature or denial; it never returns key material or an exportable secret.
- Expose the agent only through a per-user socket/pipe with owner-only file
  permissions, authenticated peer/process checks where the platform supports
  them, and a per-launch identity. Reject requests from other local users or
  untrusted processes.
- Require explicit confirmation for each signing request in the first slice.
  The confirmation shows the key fingerprint/label, algorithm, remote host,
  connection, requested operation, and destination policy.
- Bind a key to allowed destinations (at minimum host, user, port, and the
  specific Voltius session). Do not treat a forwarded request, jump host, or
  reconnect as automatically equivalent to the original destination.
- Support import, lock, unlock, expiration, and removal without placing
  plaintext private keys in settings, logs, sync, telemetry, or audit records.
  Use the platform secure store where possible and minimize plaintext key
  lifetime in memory.
- Audit request, allow, deny, lock, unlock, expiry, and failure events with
  timestamps, key identity, destination, and outcome. Never record private-key
  bytes, signatures, passphrases, or terminal contents.
- FIDO2 is a later adapter. The first agent contract must not imply hardware
  key support or require FIDO2 to be installed.

## UI and settings

The existing **OS-agent forwarding** control remains labeled and documented as
forwarding. Future built-in-agent settings should be a separate area with:

- agent enabled/locked status and an explicit Lock action;
- add/import/remove key actions with fingerprint and lifetime display;
- idle timeout and maximum lifetime controls;
- destination policy review and per-request confirmation;
- a local audit view with clear retention behavior; and
- a clear explanation that forwarding and the built-in agent have different
  trust boundaries.

Reconnect, jump-host, port-forwarding, and denied-request states must identify
which agent path was involved. No setting may silently turn OS-agent forwarding
into built-in-agent use.

## Acceptance criteria

- [ ] Current OS-agent forwarding behavior and its trust warning remain
      unchanged and are tested separately from the built-in agent.
- [ ] A built-in signing request cannot proceed without owner-only IPC,
      destination policy, and the required confirmation.
- [ ] Private keys and passphrases never cross an SSH connection and never
      appear in logs, sync, telemetry, diagnostics, or audit records.
- [ ] Lock, idle expiry, lifetime expiry, removal, app restart, reconnect, and
      failed unlock paths prevent signing until policy is re-established.
- [ ] Tests cover another local user/process, confused-deputy attempts,
      forwarding versus built-in routing, denied signatures, and destination
      changes through jump hosts or reconnects.
- [ ] UI and audit entries distinguish allowed, denied, expired, failed, and
      cancelled requests without exposing sensitive payloads.
- [ ] FIDO2 is documented and versioned as a later adapter, not delivered as
      part of the first built-in-agent slice.
