import type { Context, Config } from "@netlify/functions";
import nodemailer from "nodemailer";

const TO_EMAIL = "aguilera.felipe@gmail.com";
const TO_NAME = "Felipe Aguilera";
const SUBJECT_PREFIX = "[evo.cl]";

function clean(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const form = await req.formData();
  const nombre = clean(form.get("nombre"));
  const empresa = clean(form.get("empresa"));
  const email = clean(form.get("email"));
  const mensaje = clean(form.get("mensaje"));
  const origin = req.headers.get("referer") || "evo.cl";

  // Anti-spam: honeypot field — real users never fill this, bots do
  const honeypot = clean(form.get("website"));
  // Anti-spam: timing trap — a human takes more than 3s to fill the form
  const ts = Number(form.get("ts") || 0);
  const elapsed = ts ? Date.now() - ts : null;
  const looksLikeBot = honeypot !== "" || (elapsed !== null && elapsed < 3000);

  if (looksLikeBot) {
    // Pretend success so bots don't learn to adapt — just don't send the email
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!nombre || !isValidEmail(email) || !mensaje) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing or invalid fields" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const subject = `${SUBJECT_PREFIX} Nuevo mensaje de ${nombre}${empresa ? ` (${empresa})` : ""}`;

  const plain = [
    "Nuevo mensaje desde evo.cl",
    "-".repeat(40),
    `Nombre:  ${nombre}`,
    empresa ? `Empresa: ${empresa}` : null,
    `Email:   ${email}`,
    `Fecha:   ${new Date().toISOString()}`,
    `Origen:  ${origin}`,
    "-".repeat(40),
    "",
    mensaje,
    "",
    "Responde directamente a este correo para contactar al remitente.",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const msgHtml = escapeHtml(mensaje).replace(/\n/g, "<br>");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,sans-serif;margin:0;background:#F5F3EE;">
<div style="max-width:560px;margin:28px auto;background:#fff;border:1px solid #E5E2DC;">
  <div style="background:#111111;padding:22px 28px;">
    <p style="margin:0 0 6px;font-size:10px;color:#666;letter-spacing:.12em;text-transform:uppercase;font-family:monospace;">evo.cl</p>
    <h1 style="margin:0;font-size:18px;font-weight:800;color:#fff;letter-spacing:-.01em;">Nuevo mensaje</h1>
  </div>
  <div style="padding:28px;">
    <table style="border-collapse:collapse;font-size:13px;margin-bottom:24px;width:100%;">
      <tr><td style="color:#999;padding:5px 20px 5px 0;white-space:nowrap;">Nombre</td><td style="color:#111;font-weight:600;">${escapeHtml(nombre)}</td></tr>
      ${empresa ? `<tr><td style="color:#999;padding:5px 20px 5px 0;">Empresa</td><td style="color:#111;">${escapeHtml(empresa)}</td></tr>` : ""}
      <tr><td style="color:#999;padding:5px 20px 5px 0;">Email</td><td><a href="mailto:${escapeHtml(email)}" style="color:#E4572E;text-decoration:none;">${escapeHtml(email)}</a></td></tr>
      <tr><td style="color:#999;padding:5px 20px 5px 0;">Fecha</td><td style="color:#bbb;font-size:11px;font-family:monospace;">${new Date().toLocaleString("es-CL")}</td></tr>
      <tr><td style="color:#999;padding:5px 20px 5px 0;">Origen</td><td style="color:#bbb;font-size:11px;">${escapeHtml(origin)}</td></tr>
    </table>
    <div style="border-left:3px solid #E4572E;padding:14px 18px;font-size:14px;line-height:1.7;color:#333;background:#fafafa;">${msgHtml}</div>
    <p style="margin:24px 0 0;font-size:11px;color:#bbb;">Responde directamente a este correo para contactar a ${escapeHtml(nombre)}.</p>
  </div>
</div>
</body></html>`;

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM;
  const smtpFromName = process.env.SMTP_FROM_NAME;

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    console.error("contact function: missing SMTP env vars", { smtpHost, smtpUser, smtpFrom });
    return new Response(JSON.stringify({ ok: false, error: "smtp_config" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: true,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: `"${smtpFromName}" <${smtpFrom}>`,
      to: `"${TO_NAME}" <${TO_EMAIL}>`,
      replyTo: `"${nombre}" <${email}>`,
      subject,
      text: plain,
      html,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("contact function SMTP error:", err);
    return new Response(JSON.stringify({ ok: false, error: "smtp_send" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/.netlify/functions/contact",
};
