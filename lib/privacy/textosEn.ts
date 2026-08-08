// ============================================================================
// Documentos legales en INGLÉS — cada uno es OTRO documento, no una traducción
// de interfaz.
//
// ── POR QUÉ ESTE ARCHIVO EXISTE ────────────────────────────────────────────
// Los seis documentos legales solo existían en español: quien navegaba en
// inglés aceptaba un texto que no podía leer. Esto no se arregla interpolando
// el catálogo de i18n, porque un documento legal no es copy de interfaz: cada
// idioma necesita SU documento, con su propia `version` y su propio `sha256`,
// verificados por prueba exactamente igual que los de `textos.ts`
// (`textosEn.test.ts` recalcula cada huella; una coma editada sin subir la
// versión pone la prueba en rojo).
//
// ── LA REGLA QUE ORDENA TODO LO DEMÁS: EL ESPAÑOL PREVALECE ────────────────
// Cada cuerpo abre con la cláusula «ABOUT THIS ENGLISH VERSION»: es una
// traducción de trabajo, pendiente de revisión legal externa, y si los dos
// textos discrepan prevalece el español. Esa cláusula interpola la VERSIÓN del
// documento español original (`TERMINOS_VERSION`, etc.): así, subir la versión
// de un documento español cambia el cuerpo inglés, rompe su sha256 y obliga a
// revisar la traducción. Una traducción que no se entera de que su original
// cambió es peor que no tener traducción.
//
// ── QUÉ SE REGISTRA EN `consents` (decisión documentada) ───────────────────
// El sistema de consentimientos asume UNA versión vigente por tipo
// (`versionVigente()` en `consentimientos.ts` devuelve la del documento
// español) y las rutas canónicas `/legal/<doc>` sirven el español. Mientras el
// español sea el texto vinculante —y la cláusula de arriba dice exactamente
// eso—, lo correcto es que `consents` siga registrando la versión y la huella
// ESPAÑOLAS: es el documento que vincula, y el propio texto inglés remite a él.
// Las versiones inglesas (`en-v1-2026-08`) usan un prefijo distinto a propósito:
// si algún día el producto decide registrar la aceptación EN INGLÉS como tal,
// la cadena es distinguible a simple vista y `cubreVersionActual()` —que
// compara igualdad exacta— jamás confundirá una con otra (hay prueba). Ese
// cableado exige tocar `consentimientos.ts` y su ruta API, que no son de este
// bloque: pedido anotado.
//
// Texto plano, NUNCA renderizado como HTML: mismas reglas que `textos.ts`.
// ============================================================================

import { CONTACTO_EMAIL } from './avisos.ts'
import { POLITICA_RETENCION } from './retencion.ts'
import {
  COOKIES_VERSION,
  DOCUMENTOS_LEGALES,
  MENORES_VERSION,
  NO_ES_TERAPIA_VERSION,
  PRIVACIDAD_VERSION,
  RETENCION_VERSION,
  TERMINOS_VERSION,
  rutaDocumento,
  type DocumentoLegal,
  type TipoDocumentoLegal,
} from './textos.ts'

// Primera edición inglesa de los seis. El prefijo `en-` no es decorativo: hace
// imposible confundir en `consents.version` una aceptación del documento
// inglés con una del español (formatos `en-vN-…` vs `vN-…`).
export const TERMINOS_EN_VERSION = 'en-v1-2026-08'
export const PRIVACIDAD_EN_VERSION = 'en-v1-2026-08'
export const COOKIES_EN_VERSION = 'en-v1-2026-08'
export const NO_ES_TERAPIA_EN_VERSION = 'en-v1-2026-08'
export const MENORES_EN_VERSION = 'en-v1-2026-08'
export const RETENCION_EN_VERSION = 'en-v1-2026-08'

const ACTUALIZADO_EN = '2026-08-05'

/** Ruta pública de la versión inglesa. Derivada de `rutaDocumento()` para que
 *  no puedan divergir; sigue bajo `/legal/…`, que es lo que `proxy.ts` deja
 *  pasar sin sesión. */
export function rutaDocumentoEn(tipo: TipoDocumentoLegal): string {
  return `/legal/en${rutaDocumento(tipo).slice('/legal'.length)}`
}

/**
 * La cláusula que encabeza TODOS los cuerpos ingleses. Interpola el título, la
 * versión y la ruta del original español: subir la versión española rompe el
 * sha256 inglés y fuerza la revisión de la traducción (ver cabecera).
 */
function notaDeTraduccion(tituloOriginal: string, versionOriginal: string, rutaOriginal: string): string {
  return `ABOUT THIS ENGLISH VERSION

This document is a working translation of the Spanish original «${tituloOriginal}» (version ${versionOriginal}), which you can read at ${rutaOriginal}. It exists so you can read in English what you are agreeing to, and it is pending external legal review. If this translation and the Spanish text ever disagree, the Spanish version prevails until that review is completed.`
}

// ── Retención: traducción POR CLAVE de las descripciones ────────────────────
// El cuerpo inglés de /legal/en/retencion se GENERA desde POLITICA_RETENCION,
// igual que el español: la tabla de plazos NO se duplica, solo se traducen los
// tres campos de prosa de cada entrada. Si alguien añade una tabla a la
// política sin traducirla, pasan dos cosas a la vez: el cuerpo generado cambia
// (rompe el sha256 de abajo) y `textosEn.test.ts` señala la tabla que falta en
// este mapa por su nombre.
interface TextosRetencionEn {
  plazo: string
  baseLegal: string
  justificacion: string
}

export const TRADUCCION_RETENCION_EN: Readonly<Record<string, TextosRetencionEn>> = {
  identity_vault: {
    plazo: 'life of the account',
    baseLegal: 'Art. 6.1.b GDPR — performance of the contract (one account per person)',
    justificacion:
      'It is the only row linking a pseudonym to a real person, so it is the first thing destroyed when the account is deleted and does not outlive it by even a minute.',
  },
  profiles: {
    plazo: 'life of the account, then anonymised indefinitely',
    baseLegal: 'Art. 6.1.b GDPR + art. 17.3.e (rights of others)',
    justificacion:
      'The row is not deleted when the account is: it is anonymised in place, because the comments with which that person accompanied others hang from it, and deleting it would destroy them.',
  },
  posts: {
    plazo: 'life of the account',
    baseLegal: 'Art. 6.1.b GDPR',
    justificacion:
      'On account deletion the body is replaced with a gravestone text and the row is kept empty of content, so that the comments other people left in that thread are not left dangling.',
  },
  comments: {
    plazo: 'indefinite, pseudonymised after deletion',
    baseLegal: 'Art. 17.3.e GDPR — rights of others',
    justificacion:
      'The comment you wrote is at the same time the support another person received on their worst day: it is kept, attributed to an already anonymised profile.',
  },
  karma_events: {
    plazo: 'indefinite, pseudonymised',
    baseLegal: 'Art. 6.1.f GDPR — legitimate interest (integrity of the economy)',
    justificacion:
      'It is the reputation ledger and the only source of truth: the karma columns in profiles are just its cache, and without the ledger they can be neither rebuilt nor audited.',
  },
  crystal_ledger: {
    plazo: '6 years',
    baseLegal: 'Art. 30 of the Spanish Commercial Code and art. 66 of the Spanish General Tax Law',
    justificacion:
      'Accounting record of real purchases: the commercial duty to preserve it prevails over the right to erasure (art. 17.3.b). The cron does not purge it because a trigger makes it append-only on purpose; retiring it after 6 years is a manual, deliberate operation.',
  },
  crisis_events: {
    plazo: '5 years',
    baseLegal: 'Art. 17.3.e GDPR — establishment and defence of legal claims',
    justificacion:
      'It is the table that answers, before a regulator or a family, the question «what did the system do when this person said that?», and that period is the limitation period for personal actions.',
  },
  moderation_flags: {
    plazo: '2 years',
    baseLegal: 'Art. 6.1.f GDPR — legitimate interest (community safety)',
    justificacion:
      'Recidivism can only be measured with history; beyond two years an old signal says more about the past than about current risk. Only flags already resolved or dismissed are purged.',
  },
  refuge_messages: {
    plazo: '2 years',
    baseLegal: 'Art. 5.1.e GDPR — storage limitation',
    justificacion:
      'The server stores ciphertext it cannot read; keeping it longer gives nothing to anyone and does increase what is lost in a breach.',
  },
  content_views: {
    plazo: '90 days',
    baseLegal: 'Art. 5.1.c GDPR — data minimisation',
    justificacion:
      'Its only purpose is not repeating a video you already watched; a years-long playback history is a behavioural profile we do not need to have.',
  },
  content_sessions: {
    plazo: '90 days',
    baseLegal: 'Art. 5.1.c GDPR — data minimisation',
    justificacion:
      'Playback heartbeats to accredit real watch time: once their anti-fraud purpose is served, there is no reason to keep them.',
  },
  rate_limits: {
    plazo: '1 day',
    baseLegal: 'Art. 6.1.f GDPR — legitimate interest (abuse prevention)',
    justificacion:
      'A per-window counter that can be truncated whole without losing anything: doing so would only open the window to everyone for an interval.',
  },
  consents: {
    plazo: 'life of the account + 5 years',
    baseLegal: 'Art. 7.1 GDPR — duty to be able to demonstrate consent',
    justificacion:
      'If the fingerprint of the accepted text and the moment of acceptance are not kept, consent cannot be demonstrated; keeping them is the very compliance with the article that requires it.',
  },
  privacy_requests: {
    plazo: '3 years',
    baseLegal: 'Arts. 5.2 and 12 GDPR — accountability',
    justificacion:
      'It is the proof that an access or erasure request was handled within the art. 12.3 deadline; without it, «we did it» is not demonstrable.',
  },
  retired_aliases: {
    plazo: 'indefinite',
    baseLegal: 'Art. 6.1.f GDPR — legitimate interest (community integrity)',
    justificacion:
      'An alias freed by a deletion can never be claimed again: whoever registered it would inherit, in the eyes of the community, a history of threads that is not theirs. An alias is not personal data once the identity vault is emptied.',
  },
  auth_totp: {
    plazo: 'life of the account',
    baseLegal: 'Art. 32 GDPR — security of processing',
    justificacion: 'Second-factor secret: it is destroyed with the account, in the same transaction.',
  },
  refuge_members: {
    plazo: 'life of the refuge',
    baseLegal: 'Art. 17.3.e GDPR — rights of others',
    justificacion:
      'Leaving a refuge sets `left_at`, it does not delete the row: removing it would rewrite the thread of whoever stays.',
  },
  kindred: {
    plazo: 'life of the account',
    baseLegal: 'Art. 6.1.b GDPR',
    justificacion:
      'A private notebook of kindred souls, with notes written by its owner about other people: it is deleted whole when the account is, it holds up nothing of anyone.',
  },
  blocks: {
    plazo: 'indefinite',
    baseLegal: 'Art. 6.1.f GDPR — legitimate interest (personal safety)',
    justificacion:
      'The block protects the person who set it; when an account is deleted the hand-written reason is emptied but the row is kept, because removing it would reopen a channel somebody closed on purpose.',
  },
  post_votes: {
    plazo: 'life of the account',
    baseLegal: 'Art. 6.1.b GDPR',
    justificacion:
      'A pseudonymous vote that only feeds an aggregate counter; after deletion it is kept, tied to the already anonymised profile, so as not to unbalance the counter of somebody else’s post.',
  },
  poll_votes: {
    plazo: 'life of the account',
    baseLegal: 'Art. 6.1.b GDPR',
    justificacion:
      'Same as post votes: withdrawing it would change the result of another person’s poll, and the vote is already anonymous even to whoever created the poll.',
  },
  gifts: {
    plazo: '6 years',
    baseLegal: 'Art. 30 of the Spanish Commercial Code',
    justificacion:
      'A movement with an economic counterpart in crystals; the hand-written message is emptied on account deletion, the amounts are not.',
  },
  boosts: {
    plazo: '6 years',
    baseLegal: 'Art. 30 of the Spanish Commercial Code',
    justificacion: 'Record of a visibility purchase: the same commercial period as the rest of the economy.',
  },
}

function cuerpoRetencionEn(): string {
  const entradas = POLITICA_RETENCION.map((r) => {
    // Si falta la traducción de una tabla nueva se usa el texto español: un
    // documento que dice la verdad en el idioma equivocado es menos malo que
    // uno que dice `undefined`. El sha256 cambia igualmente y la prueba de
    // paridad de claves señala la tabla por su nombre.
    const en = TRADUCCION_RETENCION_EN[r.tabla] ?? {
      plazo: r.plazo,
      baseLegal: r.baseLegal,
      justificacion: r.justificacion,
    }
    return (
      `${r.tabla}\n` +
      `  Period: ${en.plazo}\n` +
      `  Legal basis: ${en.baseLegal}\n` +
      `  Why: ${en.justificacion}\n` +
      `  Automatic batched deletion: ${r.purgaAutomatica ? 'yes' : 'no'}`
    )
  }).join('\n\n')

  return `${notaDeTraduccion(DOCUMENTOS_LEGALES.retencion.titulo, RETENCION_VERSION, rutaDocumento('retencion'))}

How long we keep each thing, and why.

This page is not a summary of the policy: it is generated from the policy the
code actually enforces. If a table appears here with a retention period, that
period is the one that runs; and if someone added a table with personal data
without classifying it, an automatic test would stop it before it reached
production.

The sweep is done by a database function that deletes in bounded batches. Never
an unbounded mass delete: it would lock the table and take the application down
exactly when someone needs it.

${entradas}

Two periods deserve a separate explanation.

The accounting record of purchases is kept for six years even if you request
erasure. It is not an exception we invented: the right to erasure yields to a
legal duty of preservation (art. 17.3.b GDPR), and keeping the books for six
years is one of them. What does disappear is the link to your real identity.

The crisis log is kept for five years. It is the table that makes it possible
to answer — to you, to a family or to a regulator — what the system did when
somebody wrote that they wanted to die. Deleting it after a month would leave
us unable to account for ourselves precisely in the one place where accounting
for ourselves is mandatory.`
}

const CUERPO_TERMINOS_EN = `${notaDeTraduccion(DOCUMENTOS_LEGALES.terminos.titulo, TERMINOS_VERSION, rutaDocumento('terminos'))}

These terms explain what Darma is, what you can expect from us and what we
expect from you. They are written to be read, not to be signed unread.

1. WHAT DARMA IS

Darma is an anonymous peer-support network. There are no photos, no real names,
no phone numbers. Each person has a pseudonym and a generated avatar, and that
is their entire public identity.

Darma is not a healthcare service and not an emergency service. This has its
own page, /legal/en/no-es-terapia, and it is worth reading.

2. WHO CAN OPEN AN ACCOUNT

You must be at least 16 years old. The reason, and what happens between 16 and
18, is at /legal/en/menores.

One person, one account. To be able to uphold that rule without knowing who you
are, we keep an irreversible cryptographic fingerprint of your contact detail
in an isolated table.

Apart from that, if you decide to link an email address so you can recover your
account, that address is stored readable in the sign-in system and is
associated with your account. It is optional and it is your choice: without it
you can sign in all the same, but if you lose your device you lose the account.
We explain this in detail at /legal/en/privacidad.

3. RECIPROCITY: HOW THE RIGHT TO POST IS EARNED

Listening to three people unlocks one post. The first one is free, because
demanding that you listen before ever having seen the application would mean
nobody gets to speak.

Only quality listening counts: a two-word comment does not accredit. This rule
does not live in the interface, it lives in the database, so it applies the
same wherever the request comes from.

4. KARMA AND CRYSTALS

Karma is earned by accompanying others and has a daily cap. Crystals are
bought.

The product's red line: money never buys karma, nor listening priority, nor a
way to skip the queue when there is a crisis. If it ever did, Darma would have
stopped being this.

5. WHAT YOU CANNOT DO HERE

· Publish contact details, yours or anyone else's. The application detects them
  and blocks the submission. It is not paternalism: everyone's anonymity
  depends on nobody breaking it on their own.
· Content that promotes self-harm, suicide or eating disorders. Talking about
  what is happening to you is fine and is the reason Darma exists; encouraging
  another person to hurt themselves is not.
· Harassment, threats, and using the application to reach someone who blocked
  you.
· Impersonating another person or claiming the pseudonym of someone who left.
· Automating accounts, farming karma or manipulating the feed.

6. MODERATION

We can hide content, restrict an account or close it. We also use
shadow-banning: the account keeps working normally but its content stops
entering anyone's feed. It is deliberate, and it is not announced: against
harassment it works far better than an expulsion, which only produces another
new account.

If you believe we got it wrong with you, you can write to us at
${CONTACTO_EMAIL} and a person will review it.

7. YOUR CONTENT

What you write is yours. You give us permission to show it inside Darma, and
for nothing else: we do not sell it, we do not hand it to third parties and we
do not train commercial models with it.

When you delete your account, what you wrote about yourself is removed and what
you wrote to accompany other people is kept with no identifiable author. This
is explained in full, with its reasons, at /legal/en/privacidad. It is worth
reading BEFORE pressing the button.

8. AVAILABILITY

We do what we can to keep Darma up, but we cannot guarantee there will be no
outages. If you are in danger, do not depend on this application: call 112, or
024 if you are in Spain.

9. CHANGES

If we change these terms, the version number goes up and we ask you again. The
version you accepted is recorded together with the fingerprint of the exact
text you had in front of you, so that «you accepted the terms» means something.

10. GOVERNING LAW

Spanish law and the General Data Protection Regulation apply. If you are a
consumer, none of this takes away any right the law grants you.`

const CUERPO_PRIVACIDAD_EN = `${notaDeTraduccion(DOCUMENTOS_LEGALES.privacidad.titulo, PRIVACIDAD_VERSION, rutaDocumento('privacidad'))}

Darma stores the most intimate things a person writes. This page explains what
we do with that, plainly.

The data controller is the owner of the Darma project, a natural person, not a
company, reachable at ${CONTACTO_EMAIL}. That mailbox is not a form and
not a robot: it is read by the same person who maintains the application.

1. THE PRINCIPLE

We do not protect your identity by hiding it in the interface. We protect it by
not having it anywhere the application can read it.

Your public profile contains no email, no phone number and no real name: there
is not even a column to put them in. The only point in the system where the
link to the real person exists is an isolated table the application has no
access to: no bug in a route, no badly written query, no forgotten permission
can pull it out of there.

2. WHAT WE KEEP

· Your pseudonym, your avatar seed and your bio, if you write one.
· What you post and comment.
· Your karma, your listening credits and your crystals.
· An irreversible cryptographic fingerprint of your email or phone number, in
  the isolated table. It serves one single purpose: that one person does not
  have ten accounts.
· IF AND ONLY IF you link an email address to be able to recover your account:
  that address, as is, in the sign-in system of our identity provider. It is
  not the same thing as the fingerprint of the previous line and you should
  know the difference. The fingerprint cannot be undone; the email is readable,
  and it is associated with the same account as your pseudonym. Whoever
  administers the infrastructure can see it. Linking it is optional: without it
  you sign in all the same, but if you lose your device you lose the account.
· The consents you have given, with their version and the fingerprint of the
  text.

What we do NOT keep: your IP address tied to what you write, your user-agent,
your location, your date of birth, or any photo or voice recording. Camera and
microphone are denied at browser level by the application itself: face and
voice are biometric identifiers, and their mere possibility would change what
people dare to tell.

3. THE FINGERPRINT OF YOUR CONTACT DETAIL CANNOT BE UNDONE

The fingerprint is computed with a secret key that lives only in the server
environment and is not stored next to the fingerprint. This means two things:

· We cannot recover your email from it. Nobody can.
· When you delete your account, that row is removed for good and there is
  absolutely nothing left to start from, not even with the secret key.

And one clarification that has to be made, because without it the above reads
as something it is not: all of this is about THE FINGERPRINT. If you also
linked an email to be able to recover the account, that email is readable and
is associated with your pseudonym inside the sign-in system. The fingerprint
protects you from whoever sees the community database; it does not make your
account impossible to identify for whoever administers the infrastructure.

If what you need is anonymity from everyone, including us: do not link an
email. It is the default option and asks nothing of you.

4. YOUR RIGHT TO TAKE YOUR DATA WITH YOU

You can download everything of yours from your profile. It is a structured JSON
file — not a table dump — with your profile, your karma and its history, your
posts, your comments, the support you received, the content you watched, your
crystals, your consents and your previous requests.

Three things do not go in the export, and all three have a reason:

· The fingerprint of your contact detail. It is of no use to you — it is not a
  datum, it is a hash — and exporting it would weaken multi-account detection
  for everyone.
· The pseudonyms of the other people who appear in your threads. Their
  pseudonym is their datum, not yours.
· Who wrote the comments you received. The text is there, because it is
  addressed to you and is part of your story; the author is not, because that
  comment is personal data OF THAT OTHER PERSON.

The download link expires after 24 hours, works exactly once and only with your
session open. A leaked export link would be the complete dump of somebody's
emotional life, so we treat it as such. You can request one export every 24
hours.

5. YOUR RIGHT TO DISAPPEAR, AND WHAT SURVIVES

This is the part almost nobody expects and that you have the right to know
BEFORE pressing the button.

How the process works:

· You request the deletion and a second confirmation step arrives, with a
  single-use link that expires in 24 hours. It exists so that a stolen session
  or a browser glitch cannot delete anyone's account.
· On confirming, you have 30 days to change your mind. During that time your
  account is suspended: it stops appearing to others, but you still see it and
  can cancel the deletion with one click.
· After the 30 days it is executed, and always within the one-month deadline
  set by art. 12.3 GDPR.

What exactly happens when it is executed:

FIRST, and always, the row linking you to your real person is destroyed. It is
the first thing done, not the last. From that instant on, everything else that
remains is a pseudonym with nobody behind it.

WHAT YOU WROTE ABOUT YOURSELF IS REMOVED. The body of your posts is replaced
with a gravestone text and the topic disappears. The post's row is kept, empty,
for one concrete reason: if it disappeared entirely, the comments other people
left you in that thread would be left dangling and the application's counters
would lie.

WHAT YOU WROTE FOR OTHER PEOPLE IS KEPT. Your comments stay where they are,
attributed to an already anonymised profile. We say it in so many words because
it is not what people expect: your deletion cannot rob another person of the
support they received. That comment you left at three in the morning is yours
and is, at the same time, what held somebody up on their worst day; deleting it
would leave the author of that post without the reply that reached them, with a
reply counter that lies and with their «this helped me» pointing at nothing.
The GDPR contemplates exactly this in its article 17.3: the right to erasure
yields when it collides with the rights of others, and here anonymisation
fulfils the real goal, which is that nobody can know who wrote it.

If this does not work for you, write to us at ${CONTACTO_EMAIL} before
deleting the account and we will look at it case by case. We would rather talk
it through than have you find out afterwards.

YOUR PROFILE IS NOT DELETED, IT IS ANONYMISED IN PLACE. Your pseudonym becomes
an anonymous one of the form «alguien_1a2b3c4d», the avatar changes, the bio is
erased, spendable karma and crystals are set to zero and the account stops
appearing in feeds and rankings. Reputation karma is kept because the level
shown on old threads depends on it, and a number identifies nobody. Your
previous pseudonym is retired forever: nobody will be able to register it and
inherit your history in the eyes of the community.

YOUR ACCESS DISAPPEARS. The sign-in account is deleted, with its sessions and
its second factor. There is no way back in, for you or for anyone.

WHAT IS KEPT PSEUDONYMISED, AND WHY: the karma ledger (it is the bookkeeping of
the economy), the crystal ledger (six years, a commercial-law obligation) and
the crisis log (five years, to be able to answer what the system did when
somebody said they wanted to die). None of the three keeps any link to your
real identity, because that row no longer exists. Your reports stop being tied
to your pseudonym.

IN THE REFUGES you leave every room and your messages are withdrawn. The
content of those conversations is encrypted on your device and the server has
never been able to read it: its real deletion is a matter of keys, not of rows.

6. HOW LONG WE KEEP EACH THING

It is at /legal/en/retencion, table by table, with its period and its legal
basis.

7. WHO ELSE SEES YOUR DATA

Nobody who is not necessary. There are no third-party analytics, no external
fonts, no social SDKs, no tracking pixels: every outgoing request would be
someone who could learn that you were here.

The providers that do intervene are the infrastructure ones — application
hosting and database —, with the data hosted in the European Union, and an
automatic classification provider that reviews text to detect risk and
listening quality. None of them receives your real identity, because we do not
have it accessible either.

8. AUTOMATED DECISIONS

An automatic classifier judges whether a comment counts as listening and
whether a text signals risk. It can affect you: a non-validated comment does
not accredit reciprocity. You can ask for human review by writing to us at
${CONTACTO_EMAIL}, and the risk queue is always reviewed by a person.

When in doubt, the system escalates upwards. A false positive is an annoyance;
a false negative is irreversible.

9. YOUR RIGHTS

Access, rectification, erasure, restriction, portability and objection. The
first three you can exercise yourself from inside the application, without
writing to anyone and without identifying yourself, which is how it should be.
For the rest, write to us at ${CONTACTO_EMAIL}.

You can also lodge a complaint with the Spanish data protection authority, the
Agencia Española de Protección de Datos.

10. A LIMITATION WE PREFER TO STATE

If a legal guardian asks us to delete a minor's account, we cannot comply:
doing so would require re-identifying that person, and the system is incapable
of that by design. The path is for that person to request it from their own
account. If somebody is at risk, write to us at ${CONTACTO_EMAIL} and we
will handle it through the crisis protocol, not the privacy one. It is
explained at /legal/en/menores.`

const CUERPO_COOKIES_EN = `${notaDeTraduccion(DOCUMENTOS_LEGALES.cookies.titulo, COOKIES_VERSION, rutaDocumento('cookies'))}

Darma uses the cookies it strictly needs in order to work, and none beyond
that.

What we store in your browser:

· The authentication session cookie. It is what keeps you signed in from one
  screen to the next. Without it there is no application.
· The associated refresh token, so we do not ask you to sign in every hour.
· Your language and theme preference, if you change them.

That is all. There are no analytics cookies, no advertising cookies, no
third-party cookies. There are no pixels, no external fonts, no social network
scripts. The application's content security policy blocks requests to any
domain that is not ours, so even if someone added a tracker by mistake, the
browser would reject it.

That is why you will not see a cookie banner asking for your permission: there
is nothing to consent to. Cookies strictly necessary to provide a service you
asked for do not require prior consent, and we use no others.

If you clear your browser's cookies, you will be signed out. Nothing more.`

const CUERPO_NO_ES_TERAPIA_EN = `${notaDeTraduccion(DOCUMENTOS_LEGALES.no_es_terapia.titulo, NO_ES_TERAPIA_VERSION, rutaDocumento('no_es_terapia'))}

Darma is a peer-support network. The person reading you on the other side is
someone who has been through something similar and has decided to give you some
of their time. That has real value and is proven to help: feeling heard without
being judged changes how a hard moment is lived through.

What we are not is a healthcare service.

At Darma there are no mental health professionals attending your case. Nobody
who replies to you is making a diagnosis, or prescribing a treatment, or
following your progress. Nor are we an emergency service: there is nobody on
call twenty-four hours a day waiting for your message, and a message here is
not a call to 112.

The two things do not compete. You can be in therapy and use Darma; a great
many people do, because one session a week leaves six days in between. And if
you have not yet taken the step of seeking professional help, being here is not
a substitute for taking it: it is, with luck, the place where someone keeps you
company while you decide.

When it is worth seeking professional help in addition to writing here:

· When what you feel has gone weeks without moving.
· When you have stopped doing things you used to sustain: eating, sleeping,
  working, seeing people.
· When the idea of hurting yourself appears, even in passing.
· When someone around you has said so and you have brushed it off.

If you are in danger right now, do not write a post: call 112 (emergencies in
the European Union) or 024 (the suicidal-behaviour helpline in Spain, free of
charge and round the clock). In Darma the help button is always visible, on
every screen, and behind it there are real phone numbers for the country you
are connecting from.

None of this is small print to cover ourselves. It is what we wish someone had
told us plainly.`

const CUERPO_MENORES_EN = `${notaDeTraduccion(DOCUMENTOS_LEGALES.menores.titulo, MENORES_VERSION, rutaDocumento('menores'))}

The minimum age to have an account on Darma is 16.

1. WHY 16 AND NOT 14

The GDPR lets each Member State set the age of digital consent between 13 and
16; Spain has it at 14. Darma sets 16 for product and risk reasons, not
compliance ones.

This is a place where people talk about what hurts, and it is a community of
peers with no professionals on duty. Setting the bar above the legal minimum of
most jurisdictions also has a practical consequence: we do not need to collect
a parent's consent for information society services. And that matters more
than it seems, as explained in section 4.

2. HOW IT IS CHECKED, AND WHAT WE DO NOT DO

At sign-up we ask for a declared date of birth. It is used to compute whether
you reach 16, and only the minimum-age consent is recorded, with its version:
the date is NOT stored. Storing the exact date of birth would add one more
identifier in an application whose commitment is precisely the opposite.

If the declared date belongs to a person under 16, the account is not created
and that date is not stored either.

We never ask for an identity document. To say it plainly: demanding ID to
protect one minor would destroy the anonymity of everyone else, which is what
makes someone dare to write here what they have told no one. The cure would be
worse than the disease.

3. SELF-DECLARATION IS NOT VERIFICATION

We acknowledge it in so many words: an age checkbox verifies nothing. Someone
who is 15 can type a different date. That is why we do not entrust the
protection of minors to the checkbox, but to controls that apply to the whole
community and to additional controls for accounts declared under 18:

· The crisis protocol is always on, for everyone, and the help button is
  visible on every screen.
· No private messaging with strangers for accounts declared under 18: only
  with people with whom a relationship already exists in the application.
· No in-app purchases for under-18s.
· A lower moderation threshold: what would be a mild signal on an adult
  account escalates to human review on an account declared minor.

4. PARENTAL CONSENT: WHY WE DO NOT COLLECT IT

For 16- and 17-year-olds, wherever a local rule requires parental
authorisation for health-related services, Darma will NOT collect the parent's
data.

The reason is that doing so would force us to link the minor to an
identifiable adult, and that link is exactly the one that breaks the anonymity
protecting them. A teenager who writes that their home is not a safe place
cannot do so in an application that has their father's email on file.

Our answer there is not to collect identity: it is to restrict features. Less
surface, not more data.

This decision was taken deliberately and is a reasoned interpretation, not a
certainty: it is on record as a point pending external legal review before
Darma opens to the public. This English version is, in addition, a working
translation of the Spanish original: until that review is completed, the
Spanish text prevails.

5. IF YOU ARE A PARENT OR A GUARDIAN

We cannot act on a request to delete your child's account. It is not an
administrative refusal: to do it we would have to find out which account is
theirs, and the system is built so that this is impossible even for us. There
is no query that answers «which account belongs to this person».

The only path is for that person to request it themselves, from their own
account. They can do it in two clicks and without explaining themselves to
anyone.

If your concern is that they are at risk, write to us at ${CONTACTO_EMAIL}
and we will handle it through the crisis protocol, not the privacy one. There
we can help, and it is the right door.`

export const DOCUMENTOS_LEGALES_EN: Readonly<Record<TipoDocumentoLegal, DocumentoLegal>> = {
  terminos: {
    tipo: 'terminos',
    version: TERMINOS_EN_VERSION,
    actualizadoEn: ACTUALIZADO_EN,
    titulo: 'Terms of use',
    cuerpo: CUERPO_TERMINOS_EN,
    sha256: '1e7e3092e9ccf73d41573151b1689149eef41632a9fbda283e615b132ddeedf7',
  },
  privacidad: {
    tipo: 'privacidad',
    version: PRIVACIDAD_EN_VERSION,
    actualizadoEn: ACTUALIZADO_EN,
    titulo: 'Privacy and data protection',
    cuerpo: CUERPO_PRIVACIDAD_EN,
    sha256: '2860dec46b7913e63e509077085bd22ab34754c8f8090821c44af180d3e47bab',
  },
  cookies: {
    tipo: 'cookies',
    version: COOKIES_EN_VERSION,
    actualizadoEn: ACTUALIZADO_EN,
    titulo: 'Cookies',
    cuerpo: CUERPO_COOKIES_EN,
    sha256: '076e2df3efe2b3475dbd19d6c97238ff21a0c13713c49326c8a89a5c23d553a6',
  },
  no_es_terapia: {
    tipo: 'no_es_terapia',
    version: NO_ES_TERAPIA_EN_VERSION,
    actualizadoEn: ACTUALIZADO_EN,
    titulo: 'Darma is not a substitute for therapy',
    cuerpo: CUERPO_NO_ES_TERAPIA_EN,
    sha256: '47d900eefff873f64582d02ba73f20c7803b908aca2496e72c38631f653d127b',
  },
  menores: {
    tipo: 'menores',
    version: MENORES_EN_VERSION,
    actualizadoEn: ACTUALIZADO_EN,
    titulo: 'Minimum age and minors',
    cuerpo: CUERPO_MENORES_EN,
    sha256: 'a7403d2c77c5952becebdd3163eff4afe9d013468b21a6ff7e63d8d78c93c98a',
  },
  retencion: {
    tipo: 'retencion',
    version: RETENCION_EN_VERSION,
    actualizadoEn: ACTUALIZADO_EN,
    titulo: 'How long we keep each thing',
    cuerpo: cuerpoRetencionEn(),
    sha256: '12ea6ccadca9bf13023603210585ad41368525239c67aa747bb159328f0d5464',
  },
}

/**
 * El documento que corresponde servir a un locale, con fallback a español.
 *
 * El español es el fallback y no al revés: es el documento vinculante (ver
 * cabecera) y el único que el sistema de consentimientos registra hoy.
 */
export function documentoParaLocale(tipo: TipoDocumentoLegal, locale: 'es' | 'en'): DocumentoLegal {
  return locale === 'en' ? DOCUMENTOS_LEGALES_EN[tipo] : DOCUMENTOS_LEGALES[tipo]
}
