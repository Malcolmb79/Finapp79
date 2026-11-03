import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api, type AppUser } from "../api/client.js";

/**
 * The browser half of the passkey ceremonies.
 *
 * Thin on purpose: the server issues the options, the authenticator does the
 * interesting part, and the server verifies the answer. All this does is carry
 * the three between them — and go through `api` rather than `fetch`, so a
 * failure surfaces the sentence the route wrote rather than a status code.
 */

/** Whether this browser can do WebAuthn at all. */
export function passkeysSupported(): boolean {
  return browserSupportsWebAuthn();
}

/**
 * Whether the ceremony was dismissed rather than failing.
 *
 * Cancelling the authenticator prompt — hitting escape, closing the system
 * dialog — rejects exactly like a real failure does, and the browser reports
 * it as NotAllowedError or AbortError. Showing "that passkey didn't work" to
 * someone who chose not to use one is noise about their own decision.
 */
export function isCancellation(err: unknown): boolean {
  return err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError");
}

/**
 * Registers a passkey.
 *
 * With `email`, this creates the account as well — the first passkey has to be
 * registerable by someone who is not yet signed in, or there would be no way
 * to get in at all. Without it, the server takes the account from the session
 * and this adds another device to it.
 */
export async function registerPasskey(label: string, email?: string): Promise<void> {
  const options = await api.passkeyRegisterOptions(email);
  // The authenticator prompt happens here: Face ID, Touch ID, Windows Hello,
  // or a security key, depending on the device.
  const response = await startRegistration({ optionsJSON: options as never });
  await api.passkeyRegisterVerify(response, label);
}

/** Signs in with a passkey, returning the account it signed in as. */
export async function signInWithPasskey(): Promise<AppUser> {
  const options = await api.passkeyAuthOptions();
  const response = await startAuthentication({ optionsJSON: options as never });
  return api.passkeyAuthVerify(response);
}
