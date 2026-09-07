import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TEACHER_AUTHORITY_DOMAINS, isTrustedHostname } from '../../../plugins/mochi-web-search/index.mjs';

const catalog = JSON.parse(readFileSync(new URL('../teacher-resources.json', import.meta.url), 'utf8'));

test('teacher resource catalog keeps the first publisher defaults and flags the unknown English volume', () => {
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.defaults.educationStage, '高中');
  assert.equal(catalog.defaults.mainPublisher, '人民教育出版社');
  assert.equal(catalog.defaults.englishPublisher, '外语教学与研究出版社');
  assert.equal(catalog.defaults.englishEditionAndVolumeStatus, 'teacher_confirmation_required');
  const fltrp = catalog.publisherSources.find((source) => source.id === 'fltrp-high-school-english-source');
  assert.deepEqual(fltrp.teacherConfirmationRequired, ['教材版本', '册次']);
});

test('catalog source domains stay compatible with the search provider allowlist', () => {
  const domainLists = [
    ...catalog.publisherSources.map((source) => source.authorityDomains),
    ...catalog.officialPlatformSources.map((source) => source.authorityDomains),
    ...catalog.openLicensedSupplementaryResources.map((source) => source.authorityDomains),
  ];
  for (const domains of domainLists) {
    for (const domain of domains) {
      assert.equal(TEACHER_AUTHORITY_DOMAINS.includes(domain), true, `${domain} must be allowlisted`);
      assert.equal(isTrustedHostname(`www.${domain}`), true, `${domain} subdomains must be allowed`);
      assert.equal(isTrustedHostname(`${domain}.evil.example`), false, `${domain} suffix spoof must be rejected`);
    }
  }
  for (const source of [...catalog.publisherSources, ...catalog.officialPlatformSources, ...catalog.openLicensedSupplementaryResources]) {
    assert.equal(isTrustedHostname(new URL(source.sourceUrl).hostname), true, `${source.id} URL must be covered by the allowlist`);
  }
});

test('catalog makes copyright and metadata-only limits machine-checkable', () => {
  const pep = catalog.publisherSources.find((source) => source.id === 'pep-high-school-subject-index');
  assert.match(pep.rights, /不得因链接存在而下载、复制、入库/);
  const index = catalog.metadataOnlyIndexes.find((source) => source.id === 'textbook-library-catalog-index');
  assert.equal(index.codeLicense, 'MIT');
  assert.match(index.rights, /不覆盖任何教材正文/);
  const open = catalog.openLicensedSupplementaryResources.find((source) => source.id === 'openstax-biology-2e');
  assert.equal(open.license, 'CC BY-NC-SA 4.0');
  assert.match(open.useAs, /不替代中国高中教材/);
});
