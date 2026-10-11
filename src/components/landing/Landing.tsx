import Image from 'next/image';
import Link from 'next/link';
import type { Locale } from '@/i18n/locale';
import { landingMessages } from '@/i18n/messages/features/landing';
import { exerciseIcon } from '@/lib/exercises';
import { SUPPORT_URL } from '@/lib/support';
import styles from './Landing.module.css';

const SOURCE_URL = 'https://github.com/IlyaTrykin/PushupTracker';

function structuredData(locale: Locale, appUrl: string | null) {
  const m = landingMessages[locale];
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: m.appName,
    description: m.metaDescription,
    applicationCategory: 'HealthApplication',
    operatingSystem: 'Any (web, PWA)',
    inLanguage: locale,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' },
    ...(appUrl ? { url: appUrl } : {}),
  };
}

export default function Landing({ locale, appUrl }: { locale: Locale; appUrl: string | null }) {
  const m = landingMessages[locale];

  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        // JSON only, built from static strings — nothing user-supplied.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(locale, appUrl)).replace(/</g, '\\u003c') }}
      />

      <section className={styles.hero}>
        <Image className={styles.logo} src="/icons/icon-192.png" alt="" width={72} height={72} priority />
        <p className={styles.brand}>{m.appName}</p>
        <h1 className={styles.title}>{m.heroTitle}</h1>
        <p className={styles.lead}>{m.heroText}</p>
        <div className={styles.actions}>
          <Link className={styles.primary} href="/register">{m.start}</Link>
          <Link className={styles.secondary} href="/login">{m.login}</Link>
        </div>
        <p className={styles.note}>{m.free}</p>
      </section>

      <section className={styles.section} aria-labelledby="landing-features">
        <h2 id="landing-features" className={styles.h2}>{m.featuresTitle}</h2>
        <ul className={styles.features}>
          {m.features.map((f) => (
            <li key={f.title} className={styles.card}>
              <Image className={styles.cardIcon} src={exerciseIcon(f.icon)} alt="" width={56} height={56} />
              <h3 className={styles.h3}>{f.title}</h3>
              <p className={styles.cardText}>{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="landing-steps">
        <h2 id="landing-steps" className={styles.h2}>{m.stepsTitle}</h2>
        <ol className={styles.steps}>
          {m.steps.map((s, i) => (
            <li key={s} className={styles.step}>
              <span className={styles.stepNum}>{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section} aria-labelledby="landing-install">
        <h2 id="landing-install" className={styles.h2}>{m.installTitle}</h2>
        <div className={styles.install}>
          <p>{m.installIos}</p>
          <p>{m.installAndroid}</p>
        </div>
      </section>

      <section className={styles.cta}>
        <h2 className={styles.h2}>{m.ctaTitle}</h2>
        <Link className={styles.primary} href="/register">{m.start}</Link>
      </section>

      <footer className={styles.footer}>
        <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">{m.footerSupport}</a>
        <span aria-hidden="true">·</span>
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">{m.footerSource}</a>
      </footer>
    </main>
  );
}
