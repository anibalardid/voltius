import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { SnippetVariableModal } from "./SnippetVariableModal";
import { parseVariables, buildDefaultValues } from "@/services/snippetParser";

const template = "echo {{environment:choice:development,staging,production}}";
const userVars = parseVariables(template);

function renderModal(onInject = vi.fn()) {
  render(
    <SnippetVariableModal
      snippetName="deploy"
      partialTemplate={template}
      userVars={userVars}
      initialValues={buildDefaultValues(userVars)}
      onInject={onInject}
      onClose={vi.fn()}
    />,
  );
  return { onInject, select: screen.getByRole("combobox") as HTMLSelectElement };
}

afterEach(cleanup);

describe("SnippetVariableModal choice variables", () => {
  it("offers every option with the first one pre-selected", () => {
    const { select } = renderModal();
    expect([...select.options].map((o) => o.value)).toEqual([
      "development", "staging", "production",
    ]);
    expect(select.value).toBe("development");
  });

  it("substitutes the picked option", () => {
    const { onInject, select } = renderModal();
    fireEvent.change(select, { target: { value: "staging" } });
    fireEvent.click(screen.getByText("terminal.snippetVariableModal.execute"));
    expect(onInject).toHaveBeenCalledWith("echo staging", true);
  });
});

describe("SnippetVariableModal explicit preview", () => {
  it("previews and keeps Insert separate from Execute without variables", () => {
    const onInject = vi.fn();
    render(
      <SnippetVariableModal
        snippetName="status"
        partialTemplate="printf 'ready'"
        userVars={[]}
        initialValues={{}}
        onInject={onInject}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("printf 'ready'")).toBeTruthy();
    fireEvent.click(screen.getByText("terminal.shared.insert"));
    fireEvent.click(screen.getByText("terminal.snippetVariableModal.execute"));
    expect(onInject).toHaveBeenNthCalledWith(1, "printf 'ready'", false);
    expect(onInject).toHaveBeenNthCalledWith(2, "printf 'ready'", true);
  });

  it("keeps multiline script content intact in both actions", () => {
    const onInject = vi.fn();
    render(
      <SnippetVariableModal
        snippetName="multi-step shell text"
        partialTemplate={"printf 'one'\nprintf 'two'"}
        userVars={[]}
        initialValues={{}}
        onInject={onInject}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("terminal.shared.insert"));
    fireEvent.click(screen.getByText("terminal.snippetVariableModal.execute"));
    expect(onInject).toHaveBeenNthCalledWith(1, "printf 'one'\nprintf 'two'", false);
    expect(onInject).toHaveBeenNthCalledWith(2, "printf 'one'\nprintf 'two'", true);
  });

  it("masks password-like values in the preview but keeps the resolved payload", () => {
    const onInject = vi.fn();
    const secretTemplate = "curl -H 'Authorization: {{api_token:text}}'";
    const secretVars = parseVariables(secretTemplate);
    render(
      <SnippetVariableModal
        snippetName="request"
        partialTemplate={secretTemplate}
        userVars={secretVars}
        initialValues={{}}
        onInject={onInject}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("api_token"), { target: { value: "clear-secret" } });
    expect(screen.queryByText("clear-secret")).toBeNull();
    expect(screen.getByText(/••••••••/)).toBeTruthy();
    fireEvent.click(screen.getByText("terminal.snippetVariableModal.execute"));
    expect(onInject).toHaveBeenCalledWith("curl -H 'Authorization: clear-secret'", true);
  });
});
