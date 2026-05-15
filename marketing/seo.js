const {
  ASSET_VERSION,
  CHROME_WEB_STORE_URL,
  PLATFORM_PAGE_KEYS,
  abs,
  content,
  escapeAttr,
  escapeHtml,
  pageData,
  pathFor,
  safeJson
} = require('./config');

function renderHead({ pageKey, locale, nonce }) {
  const c = content(locale);
  const data = pageData(pageKey, locale);
  const meta = data.meta;
  const canonical = abs(pathFor(pageKey, locale));
  const alternateEn = abs(pathFor(pageKey, 'en'));
  const alternatePl = abs(pathFor(pageKey, 'pl'));
  const jsonLd = buildJsonLd({ pageKey, locale, data, meta, canonical });

  return `
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(meta.title)}</title>
  <meta name="description" content="${escapeAttr(meta.description)}">
  <meta name="keywords" content="${escapeAttr(meta.keywords)}">
  <meta name="author" content="QuizSolver">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#6c3dff">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="en" href="${alternateEn}">
  <link rel="alternate" hreflang="pl" href="${alternatePl}">
  <link rel="alternate" hreflang="x-default" href="${alternateEn}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="QuizSolver">
  <meta property="og:url" content="${canonical}">
  <meta property="og:title" content="${escapeAttr(meta.title)}">
  <meta property="og:description" content="${escapeAttr(meta.description)}">
  <meta property="og:image" content="${abs('/og-image.svg')}">
  <meta property="og:image:alt" content="QuizSolver AI quiz solver browser extension preview">
  <meta property="og:locale" content="${c.ogLocale}">
  <meta property="og:locale:alternate" content="${locale === 'pl' ? 'en_US' : 'pl_PL'}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(meta.title)}">
  <meta name="twitter:description" content="${escapeAttr(meta.description)}">
  <meta name="twitter:image" content="${abs('/og-image.svg')}">
  ${renderCommonAssets()}
  <script type="application/ld+json" nonce="${escapeAttr(nonce || '')}">${safeJson(jsonLd)}</script>`;
}

function renderUtilityHead({
  locale,
  nonce,
  title,
  description,
  canonicalPath,
  robots = 'noindex, nofollow',
  styles = [],
  pageKey = '',
  keywords = '',
  ogType = 'website',
  jsonLd
}) {
  const c = content(locale);
  const canonical = abs(canonicalPath);
  const alternateLinks = pageKey ? `
  <link rel="alternate" hreflang="en" href="${abs(pathFor(pageKey, 'en'))}">
  <link rel="alternate" hreflang="pl" href="${abs(pathFor(pageKey, 'pl'))}">
  <link rel="alternate" hreflang="x-default" href="${abs(pathFor(pageKey, 'en'))}">` : '';
  const pageJsonLd = jsonLd || {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'QuizSolver', url: abs('/') },
    inLanguage: locale
  };
  return `
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}">
  ${keywords ? `<meta name="keywords" content="${escapeAttr(keywords)}">` : ''}
  <meta name="author" content="QuizSolver">
  <meta name="robots" content="${escapeAttr(robots)}">
  <meta name="theme-color" content="#6c3dff">
  <link rel="canonical" href="${canonical}">
  ${alternateLinks}
  <meta property="og:type" content="${escapeAttr(ogType)}">
  <meta property="og:site_name" content="QuizSolver">
  <meta property="og:url" content="${canonical}">
  <meta property="og:title" content="${escapeAttr(title)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:image" content="${abs('/og-image.svg')}">
  <meta property="og:locale" content="${c.ogLocale}">
  <meta property="og:locale:alternate" content="${locale === 'pl' ? 'en_US' : 'pl_PL'}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(title)}">
  <meta name="twitter:description" content="${escapeAttr(description)}">
  <meta name="twitter:image" content="${abs('/og-image.svg')}">
  ${renderCommonAssets(styles)}
  <script type="application/ld+json" nonce="${escapeAttr(nonce || '')}">${safeJson(pageJsonLd)}</script>`;
}

function renderCommonAssets(styles = []) {
  const extraStyles = styles
    .map(href => `<link rel="stylesheet" href="${escapeAttr(href)}">`)
    .join('\n  ');

  return `<link rel="stylesheet" href="/site.css?v=${ASSET_VERSION}">
  ${extraStyles}`;
}

function buildJsonLd({ pageKey, locale, data, meta, canonical }) {
  const homeUrl = abs('/');
  const c = content(locale);
  const graph = [
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
      operatingSystem: 'Chrome, Chromium',
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
        'Supported quiz platform workflows'
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
        { '@type': 'ListItem', position: 2, name: data.title, item: canonical }
      ]
    });

    if (Array.isArray(data.steps) && data.steps.length) {
      graph.push({
        '@type': 'HowTo',
        '@id': `${canonical}#howto`,
        name: data.stepsTitle || data.title,
        description: data.subtitle,
        totalTime: 'PT3M',
        step: data.steps.map((step, index) => ({
          '@type': 'HowToStep',
          position: index + 1,
          text: step
        }))
      });
    }
  }

  if (pageKey === 'home' && c.home.platforms?.items?.length) {
    graph.push({
      '@type': 'ItemList',
      '@id': `${canonical}#supported-platforms`,
      name: c.home.platforms.title,
      itemListElement: c.home.platforms.items.map((name, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name
      }))
    });
  }

  if (Array.isArray(data.faq) && data.faq.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonical}#faq`,
      mainEntity: data.faq.map(item => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer
        }
      }))
    });
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph
  };
}

function sitemapUrl(pageKey, locale, priority) {
  const loc = abs(pathFor(pageKey, locale));
  const alternateEn = abs(pathFor(pageKey, 'en'));
  const alternatePl = abs(pathFor(pageKey, 'pl'));

  return `  <url>
    <loc>${loc}</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${alternateEn}" />
    <xhtml:link rel="alternate" hreflang="pl" href="${alternatePl}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${alternateEn}" />
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

function getSitemapXml() {
  const entries = [
    sitemapUrl('home', 'en', '1.0'),
    sitemapUrl('home', 'pl', '1.0'),
    ...PLATFORM_PAGE_KEYS.flatMap((pageKey, index) => {
      const priority = index <= 2 ? '0.9' : '0.85';
      return [
        sitemapUrl(pageKey, 'en', priority),
        sitemapUrl(pageKey, 'pl', priority)
      ];
    }),
    sitemapUrl('privacy', 'en', '0.4'),
    sitemapUrl('privacy', 'pl', '0.35')
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>`;
}

function getRobotsTxt() {
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin

Sitemap: ${abs('/sitemap.xml')}
`;
}

module.exports = {
  getRobotsTxt,
  getSitemapXml,
  renderHead,
  renderUtilityHead
};
