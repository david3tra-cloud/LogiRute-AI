import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import HomeSection from "../HomeSection";
import type { AppModule } from "../navigationHistory";

type Props = ComponentProps<typeof HomeSection>;

const makeProps = (overrides: Partial<Props> = {}): Props => ({
  onNavigate: vi.fn<(module: AppModule) => void>(),
  showInstallPrompt: false,
  isSafariIos: false,
  installError: null,
  isInstallPromptDeclined: false,
  hasDeferredInstallPrompt: false,
  isInstallPrompting: false,
  onInstall: vi.fn(),
  onDismissInstallPrompt: vi.fn(),
  ...overrides,
});

describe("HomeSection", () => {
  it("renders the existing area cards and navigates to their destinations", () => {
    const props = makeProps();
    render(<HomeSection {...props} />);

    expect(
      screen.getByRole("heading", { name: "Bienvenido a LogiRute" }),
    ).toBeTruthy();

    for (const [label, destination] of [
      ["Rutas", "routes"],
      ["DeCAs", "decas"],
      ["Facturación", "billing"],
    ] as const) {
      const card = screen.getByRole("button", { name: new RegExp(label) });
      card.focus();
      expect(document.activeElement).toBe(card);
      expect(card.className).toContain("focus-visible:ring-4");
      fireEvent.click(card);
      expect(props.onNavigate).toHaveBeenLastCalledWith(destination);
    }

    expect(screen.getAllByText("Abrir área")).toHaveLength(3);
  });

  it("preserves the install prompt controls and the in-progress state", () => {
    const props = makeProps({
      showInstallPrompt: true,
      hasDeferredInstallPrompt: true,
      isInstallPrompting: true,
    });
    render(<HomeSection {...props} />);

    expect(
      screen.getByText(
        "Accede más rápido desde el escritorio o la pantalla de inicio.",
      ),
    ).toBeTruthy();
    const installButton = screen.getByRole("button", {
      name: "Abriendo instalación...",
    });
    expect(installButton).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    expect(props.onDismissInstallPrompt).toHaveBeenCalledOnce();
    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it("invokes installation when the browser prompt is available", () => {
    const props = makeProps({
      showInstallPrompt: true,
      hasDeferredInstallPrompt: true,
    });
    render(<HomeSection {...props} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Instalar LogiRute" }),
    );
    expect(props.onInstall).toHaveBeenCalledOnce();
  });

  it("shows Safari installation instructions without an unsupported install action", () => {
    render(
      <HomeSection
        {...makeProps({
          showInstallPrompt: true,
          isSafariIos: true,
        })}
      />,
    );

    expect(
      screen.getByText(
        "Para instalarla, pulsa Compartir en Safari y selecciona “Añadir a pantalla de inicio”.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Instalar LogiRute" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Ahora no" })).toBeTruthy();
  });

  it("shows the message when installation was deferred", () => {
    render(
      <HomeSection
        {...makeProps({
          showInstallPrompt: true,
          isInstallPromptDeclined: true,
        })}
      />,
    );

    expect(
      screen.getByText(
        "Has pospuesto la instalación. Puedes instalar LogiRute desde el menú del navegador.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Instalar LogiRute" }),
    ).toBeNull();
  });

  it("shows installation errors and hides the prompt when it is not requested", () => {
    const error =
      "No se pudo abrir la instalación. Puedes intentarlo desde el menú del navegador.";
    const { rerender } = render(
      <HomeSection
        {...makeProps({
          showInstallPrompt: true,
          installError: error,
        })}
      />,
    );

    expect(screen.getByText(error)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Instalar LogiRute" }),
    ).toBeNull();

    rerender(<HomeSection {...makeProps()} />);
    expect(
      screen.queryByRole("heading", { name: "Instala LogiRute" }),
    ).toBeNull();
  });
});
