import { FormEvent, useState } from "react";
import { supabase } from "./supabase";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setMessage("Introduce una dirección de correo válida.");
      return;
    }
    if (password.length < 6) {
      setMessage("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    setLoading(true);
    try {
      const result = isRegistering
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

      if (isRegistering && !result.data.session) {
        setMessage(
          "Cuenta creada. Revisa tu correo para confirmar la dirección antes de iniciar sesión.",
        );
      }
    } catch {
      setMessage("No se pudo conectar con el servicio. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "60px auto", padding: 24 }}>
      <h1>{isRegistering ? "Crear cuenta" : "Iniciar sesión"}</h1>

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

        <button type="submit" disabled={loading}>
          {loading ? "Procesando..." : isRegistering ? "Registrarme" : "Entrar"}
        </button>
      </form>

      {message && <p>{message}</p>}

      <button
        type="button"
        onClick={() => {
          setIsRegistering((current) => !current);
          setMessage("");
        }}
        disabled={loading}
        style={{ marginTop: 16 }}
      >
        {isRegistering ? "Ya tengo una cuenta" : "Crear una cuenta nueva"}
      </button>
    </main>
  );
}
