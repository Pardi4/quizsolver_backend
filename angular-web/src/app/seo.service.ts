import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import {
  CHROME_WEB_STORE_URL,
  Locale,
  PageKey,
  SITE_URL,
  abs,
  contentFor,
  pageData,
  pathFor
} from './site-content';

@Injectable({ providedIn: 'root' })
export class SeoService {
  constructor(
    private readonly title: Title,
    private readonly meta: Meta,
    @Inject(DOCUMENT) private readonly document: Document
  ) {}

  applyPage(pageKey: PageKey, locale: Locale, options: { robots?: string; status404?: boolean } = {}): void {
    const copy = contentFor(locale);
    const data = pageData(pageKey, locale);
    const meta = this.resolveMeta(pageKey, locale, data);
    const canonicalPath = pathFor(pageKey, locale);
    const canonical = abs(canonicalPath);
    const robots = options.robots || (pageKey === 'dashboard' || pageKey === 'success' || pageKey === 'notFound' ? 'noindex, follow' : 'index, follow');

    this.document.documentElement.lang = copy['htmlLang'] || locale;
    this.title.setTitle(meta.title);
    this.upsertMeta('name', 'description', meta.description);
    this.upsertMeta('name', 'robots', robots);
    this.upsertMeta('name', 'author', 'QuizSolver');
    this.upsertMeta('name', 'theme-color', '#101827');
    this.upsertMeta('property', 'og:type', pageKey === 'home' ? 'website' : 'article');
    this.upsertMeta('property', 'og:site_name', 'QuizSolver');
    this.upsertMeta('property', 'og:url', canonical);
    this.upsertMeta('property', 'og:title', meta.title);
    this.upsertMeta('property', 'og:description', meta.description);
    this.upsertMeta('property', 'og:image', abs('/og-image.svg'));
    this.upsertMeta('property', 'og:image:alt', 'QuizSolver AI quiz solver browser extension preview');
    this.upsertMeta('property', 'og:locale', copy['ogLocale'] || (locale === 'pl' ? 'pl_PL' : 'en_US'));
    this.upsertMeta('property', 'og:locale:alternate', locale === 'pl' ? 'en_US' : 'pl_PL');
    this.upsertMeta('name', 'twitter:card', 'summary_large_image');
    this.upsertMeta('name', 'twitter:title', meta.title);
    this.upsertMeta('name', 'twitter:description', meta.description);
    this.upsertMeta('name', 'twitter:image', abs('/og-image.svg'));

    this.upsertLink('canonical', canonical);
    this.upsertAlternate('en', abs(pathFor(pageKey, 'en')));
    this.upsertAlternate('pl', abs(pathFor(pageKey, 'pl')));
    this.upsertAlternate('x-default', abs(pathFor(pageKey, 'en')));
    this.upsertJsonLd(this.buildJsonLd(pageKey, locale, data, meta, canonical));
  }

  private resolveMeta(pageKey: PageKey, locale: Locale, data: any): { title: string; description: string } {
    if (data?.meta?.title && data?.meta?.description) return data.meta;
    if (pageKey === 'privacy') {
      return { title: data.metaTitle, description: data.metaDescription };
    }
    if (pageKey === 'dashboard' || pageKey === 'quiz' || pageKey === 'success' || pageKey === 'notFound') {
      return { title: data.metaTitle, description: data.metaDescription };
    }
    const copy = contentFor(locale);
    return {
      title: `${data?.title || copy['common']?.brand || 'QuizSolver'} | QuizSolver`,
      description: data?.subtitle || copy['footer']?.description || 'QuizSolver AI quiz solver Chrome extension.'
    };
  }

  private upsertMeta(attr: 'name' | 'property', key: string, content: string): void {
    this.meta.updateTag({ [attr]: key, content });
  }

  private upsertLink(rel: string, href: string): void {
    const selector = `link[rel="${rel}"]`;
    let link = this.document.head.querySelector<HTMLLinkElement>(selector);
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', rel);
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', href);
  }

  private upsertAlternate(hreflang: string, href: string): void {
    let link = this.document.head.querySelector<HTMLLinkElement>(`link[rel="alternate"][hreflang="${hreflang}"]`);
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'alternate');
      link.setAttribute('hreflang', hreflang);
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', href);
  }

  private upsertJsonLd(payload: unknown): void {
    const existing = this.document.head.querySelector<HTMLScriptElement>('script[data-quizsolver-schema="main"]');
    if (existing) existing.remove();
    const script = this.document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-quizsolver-schema', 'main');
    script.textContent = JSON.stringify(payload).replace(/</g, '\\u003c');
    this.document.head.appendChild(script);
  }

  private buildJsonLd(pageKey: PageKey, locale: Locale, data: any, meta: { title: string; description: string }, canonical: string): unknown {
    const homeUrl = `${SITE_URL}/`;
    const graph: any[] = [
      {
        '@type': 'Organization',
        '@id': `${homeUrl}#organization`,
        name: 'QuizSolver',
        url: homeUrl,
        logo: abs('/og-image.svg'),
        contactPoint: {
          '@type': 'ContactPoint',
          url: abs('/privacy#contact'),
          contactType: 'customer support',
          availableLanguage: ['English', 'Polish']
        }
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${homeUrl}#software`,
        name: 'QuizSolver',
        applicationCategory: 'BrowserApplication',
        operatingSystem: 'Chrome, Chromium browsers',
        url: homeUrl,
        downloadUrl: CHROME_WEB_STORE_URL,
        installUrl: CHROME_WEB_STORE_URL,
        sameAs: [CHROME_WEB_STORE_URL],
        inLanguage: ['en', 'pl'],
        description: meta.description,
        creator: { '@id': `${homeUrl}#organization` },
        featureList: [
          'AI quiz answer suggestions',
          'Answer explanations',
          'Study Notes history',
          'Practice Mode',
          'Testportal, Moodle, Canvas, Google Forms, Microsoft Forms, Kahoot and Quizizz workflows',
          'Optional site permissions and hint mode'
        ],
        offers: [
          { '@type': 'Offer', name: '100 credit top-up', price: '1.99', priceCurrency: 'USD' },
          { '@type': 'Offer', name: '500 credit top-up', price: '4.99', priceCurrency: 'USD' },
          { '@type': 'Offer', name: '2000 credit top-up', price: '9.99', priceCurrency: 'USD' }
        ]
      },
      {
        '@type': 'WebSite',
        '@id': `${homeUrl}#website`,
        name: 'QuizSolver',
        url: homeUrl,
        publisher: { '@id': `${homeUrl}#organization` },
        inLanguage: ['en', 'pl']
      },
      {
        '@type': 'WebPage',
        '@id': `${canonical}#webpage`,
        url: canonical,
        name: meta.title,
        description: meta.description,
        isPartOf: { '@id': `${homeUrl}#website` },
        about: { '@id': `${homeUrl}#software` },
        inLanguage: locale
      }
    ];

    if (pageKey !== 'home') {
      graph.push({
        '@type': 'BreadcrumbList',
        '@id': `${canonical}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'QuizSolver', item: homeUrl },
          { '@type': 'ListItem', position: 2, name: data?.title || meta.title, item: canonical }
        ]
      });
    }

    if (Array.isArray(data?.steps) && data.steps.length) {
      graph.push({
        '@type': 'HowTo',
        '@id': `${canonical}#howto`,
        name: data.stepsTitle || data.title,
        description: data.subtitle,
        totalTime: 'PT3M',
        step: data.steps.map((step: string, index: number) => ({
          '@type': 'HowToStep',
          position: index + 1,
          text: step
        }))
      });
    }

    if (Array.isArray(data?.faq) && data.faq.length) {
      graph.push({
        '@type': 'FAQPage',
        '@id': `${canonical}#faq`,
        mainEntity: data.faq.map((item: any) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.answer
          }
        }))
      });
    }

    return { '@context': 'https://schema.org', '@graph': graph };
  }
}
