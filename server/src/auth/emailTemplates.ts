export function passwordResetEmail(resetUrl: string) {
  return {
    subject: "Reset your Personal Finance password",
    text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
    html: `<p>Reset your password by clicking the link below:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
  };
}

export function oauthOnlyAccountEmail(providerLabel: string) {
  return {
    subject: "About your Personal Finance account",
    text: `Someone requested a password reset for this email, but your account signs in with ${providerLabel}, not a password — there's nothing to reset. Use "Continue with ${providerLabel}" to sign in instead.`,
    html: `<p>Someone requested a password reset for this email, but your account signs in with <strong>${providerLabel}</strong>, not a password — there's nothing to reset. Use "Continue with ${providerLabel}" to sign in instead.</p>`,
  };
}

export function verifyEmailEmail(verifyUrl: string) {
  return {
    subject: "Verify your email — Personal Finance",
    text: `Verify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `<p>Verify your email by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
  };
}
