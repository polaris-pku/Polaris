# Local Runtime Directory Design

## Goal

Keep frontend source checkouts free of local runtime data while preserving the existing UI flow for choosing a project workspace.

## Selected Design

The local browser stack uses one application data root:

```text
<BCD>/.newide-local/
  backend/
    coordination.sqlite
    runs/
    b/
      agent-state/
      context-packs/
      maintenance/
    market/
  workspaces/
    default/
  logs/
```

The default root is resolved from the frontend checkout as `../.newide-local`. Set `NEWIDE_LOCAL_DATA_DIR` to an absolute path to override it before startup.

PostgreSQL B-memory records remain in the existing Docker volume. The new directory holds application files and pointers, not a second copy of the database.

## Workspace Selection

Workspace and application data are separate:

- A project directory selected in the frontend remains the agent workspace.
- A project without a selected directory uses `<local-data>/workspaces/<project-name>`.
- Changing workspace continues to use `/backend/configure` and restarts only the backend process.
- The application data root is selected at startup through `NEWIDE_LOCAL_DATA_DIR`; it is not changed while tasks are running.

## Backend Boundary

The web bridge passes `NEWIDE_APP_STATE_ROOT=<local-data>/backend` to `newide-scaffold`. The backend application composition uses that root for coordination state, run receipts, B application files, context packs, maintenance evidence, and market files.

No file under `newide-scaffold/src/memory/**` is modified. The existing public B runtime option is consumed from the application composition layer.

## Compatibility

- Existing runtime data is not moved or deleted automatically.
- `NEWIDE_LOCAL_DATA_DIR` is optional.
- The existing frontend project-folder picker remains unchanged.
- Electron packaging remains unchanged; this slice only changes local browser development startup.

## Acceptance

1. Start with `pnpm web:dev`.
2. Confirm ports 5173 and 4318 are ready.
3. Confirm backend status reports the selected workspace and local data root.
4. Create a Council task and confirm runtime files appear under `.newide-local/backend`.
5. Select a custom project directory in the frontend and confirm agent output is written there.
6. Confirm `newide-scaffold/src/memory/**` has no diff.
