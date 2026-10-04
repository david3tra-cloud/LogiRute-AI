import { FormEvent, useEffect, useState } from "react";
import { supabase } from "./supabase";

type AuthMode = "login" | "register" | "recover-password" | "reset-password";

const RECOVERY_PENDING_STORAGE_KEY =
  "logiroute_password_recovery_pending_v1";

const setRecoveryPending = () => {
  try {
    window.sessionStorage.setItem(RECOVERY_PENDING_STORAGE_KEY, "1");
  } catch {
    // No bloquear la UI si sessionStorage no está disponible.
  }
};

const hasRecoveryPending = () => {
  try {
    return window.sessionStorage.getItem(RECOVERY_PENDING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const clearRecoveryPending = () => {
  try {
    window.sessionStorage.removeItem(RECOVERY_PENDING_STORAGE_KEY);
  } catch {
    // No bloquear la UI.
  }
};

const isRecoveryUrl = () => {
  if (typeof window === "undefined") return false;
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const searchParams = new URLSearchParams(window.location.search);
  return (
    hashParams.get("type") === "recovery" ||
    searchParams.get("type") === "recovery"
  );
};

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mode, setMode] = useState<AuthMode>(() => {
    const recoveryUrl = isRecoveryUrl();
    if (recoveryUrl) setRecoveryPending();
    return recoveryUrl || hasRecoveryPending()
      ? "reset-password"
      : "login";
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryPending();
        setMode("reset-password");
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setMessage("Introduce una dirección de correo válida.");
      return;
    }
    if (mode !== "recover-password" && password.length < 6) {
      setMessage("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "recover-password") {
        await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: window.location.origin,
        });
        setMessage(
          "Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña.",
        );
        return;
      }

      const result =
        mode === "register"
          ? await supabase.auth.signUp({ email: normalizedEmail, password })
          : await supabase.auth.signInWithPassword({
              email: normalizedEmail,
              password,
            });

      if (result.error) {
        const error = result.error.message.toLowerCase();
        if (error.includes("invalid login credentials")) {
          setMessage("El correo o la contraseña no son correctos.");
        } else if (error.includes("user already registered")) {
          setMessage("Ya existe una cuenta con ese correo.");
        } else if (error.includes("email not confirmed")) {
          setMessage("Confirma tu correo antes de iniciar sesión.");
        } else {
          setMessage("No se pudo completar la operación. Inténtalo de nuevo.");
        }
        return;
      }

      if (mode === "register" && !result.data.session) {
        setMessage(
          "Cuenta creada. Revisa tu correo para confirmar la dirección antes de iniciar sesión.",
        );
      }
    } catch {
      if (mode === "recover-password") {
        setMessage(
          "Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña.",
        );
      } else {
        setMessage("No se pudo conectar con el servicio. Inténtalo de nuevo.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (password.length < 12) {
      setMessage("La contraseña debe tener al menos 12 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMessage(
          "No se pudo actualizar la contraseña. Inténtalo de nuevo.",
        );
        return;
      }

      clearRecoveryPending();
      setPassword("");
      setConfirmPassword("");
      let signOutFailed = false;
      try {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          signOutFailed = true;
        }
      } catch {
        signOutFailed = true;
      }
      setMode("login");
      setMessage(
        signOutFailed
          ? "Tu contraseña se ha actualizado, pero no se pudo cerrar la sesión. Cierra sesión antes de continuar."
          : "Tu contraseña se ha actualizado correctamente.",
      );
    } catch {
      setMessage("No se pudo actualizar la contraseña. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReturnToLogin() {
    clearRecoveryPending();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setMessage(
          "No se pudo cerrar la sesión. Inténtalo de nuevo antes de volver al inicio de sesión.",
        );
        return;
      }
      setMode("login");
      setPassword("");
      setConfirmPassword("");
      setMessage("");
    } catch {
      setMessage(
        "No se pudo cerrar la sesión. Inténtalo de nuevo antes de volver al inicio de sesión.",
      );
    } finally {
      setLoading(false);
    }
  }

  const isRegistering = mode === "register";

  return (
    <main style={{ maxWidth: 420, margin: "60px auto", padding: 24 }}>
      <h1>
        {mode === "reset-password"
          ? "Crear nueva contraseña"
          : mode === "recover-password"
            ? "Recuperar contraseña"
            : isRegistering
              ? "Crear cuenta"
              : "Iniciar sesión"}
      </h1>

      {mode === "reset-password" ? (
        <form onSubmit={handleResetPassword}>
          <label>
            Nueva contraseña
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
              style={{ display: "block", width: "100%", margin: "8px 0 16px" }}
            />
          </label>

          <label>
            Repetir contraseña
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
              style={{ display: "block", width: "100%", margin: "8px 0 16px" }}
            />
          </label>

          <button type="submit" disabled={loading}>
            {loading ? "Procesando..." : "Guardar nueva contraseña"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              style={{ display: "block", width: "100%", margin: "8px 0 16px" }}
            />
          </label>

          {mode !== "recover-password" && (
            <label>
              Contraseña
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
                style={{ display: "block", width: "100%", margin: "8px 0 16px" }}
              />
            </label>
          )}

          <button type="submit" disabled={loading}>
            {loading
              ? "Procesando..."
              : mode === "recover-password"
                ? "Enviar enlace de recuperación"
                : isRegistering
                  ? "Registrarme"
                  : "Entrar"}
          </button>
        </form>
      )}

      {message && <p>{message}</p>}

      {mode === "login" && (
        <>
          <button
            type="button"
            onClick={() => {
              setMode("recover-password");
              setMessage("");
            }}
            disabled={loading}
            style={{ display: "block", marginTop: 16 }}
          >
            ¿Has olvidado tu contraseña?
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setMessage("");
            }}
            disabled={loading}
            style={{ marginTop: 16 }}
          >
            Crear una cuenta nueva
          </button>
        </>
      )}
      {mode === "register" && (
        <button
          type="button"
          onClick={() => {
            setMode("login");
            setMessage("");
          }}
          disabled={loading}
          style={{ marginTop: 16 }}
        >
          Ya tengo una cuenta
        </button>
      )}
      {(mode === "recover-password" || mode === "reset-password") && (
        <button
          type="button"
          onClick={() => void handleReturnToLogin()}
          disabled={loading}
          style={{ marginTop: 16 }}
        >
          Volver al inicio de sesión
        </button>
      )}
    </main>
  );
}
