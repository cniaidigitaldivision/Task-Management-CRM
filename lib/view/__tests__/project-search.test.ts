import { describe, expect, it } from 'vitest';

import { matchesSearch, searchTerms, type SearchableProject } from '../project-search';

/* ============================================================================
 * THE PROJECT SEARCH BOX
 * ----------------------------------------------------------------------------
 * A search that quietly returns the wrong set is worse than no search: the
 * person concludes the project is not there and goes and creates it again.
 * ========================================================================= */

const CHITRAL: SearchableProject = {
  name: 'Chitral Royal Homes',
  code: 'CLI',
  clientName: 'Chitral Royal Homes (Pvt) Ltd',
  ownerName: 'Umm-e-Habiba',
};

const AGC: SearchableProject = {
  name: 'Attari Group of Companies - AGC',
  code: 'CLI',
  clientName: null,
  ownerName: 'Ammar Afzal Khan',
};

const INTERNAL: SearchableProject = {
  name: 'Internal CRM',
  code: 'OTH',
  clientName: null,
  ownerName: null,
};

const find = (query: string, list = [CHITRAL, AGC, INTERNAL]) =>
  list.filter((p) => matchesSearch(p, searchTerms(query))).map((p) => p.name);

describe('finding a project by typing', () => {
  it('matches part of a name, from one character up', () => {
    expect(find('chi')).toEqual(['Chitral Royal Homes']);
    expect(find('attari')).toEqual(['Attari Group of Companies - AGC']);
  });

  it('ignores case, which is the whole point of a search box', () => {
    expect(find('CHITRAL')).toEqual(['Chitral Royal Homes']);
    expect(find('ChItRaL')).toEqual(['Chitral Royal Homes']);
  });

  it('⚠️ matches words in any order — "royal chitral" still finds it', () => {
    /* Somebody who half-remembers a name types the memorable word first. A
       plain `includes` of the whole query fails this, and that failure is
       invisible: the person sees an empty list and believes the project is
       gone. */
    expect(find('royal chitral')).toEqual(['Chitral Royal Homes']);
    expect(find('homes chitral royal')).toEqual(['Chitral Royal Homes']);
  });

  it('narrows as you type — a second word never widens the result', () => {
    expect(find('c').length).toBeGreaterThan(1);
    expect(find('c royal')).toEqual(['Chitral Royal Homes']);
  });

  it('tolerates the extra spaces typing produces', () => {
    expect(find('  royal   homes  ')).toEqual(['Chitral Royal Homes']);
  });

  it('finds a project by its client, and by whose it is', () => {
    expect(find('pvt')).toEqual(['Chitral Royal Homes']);
    expect(find('ammar')).toEqual(['Attari Group of Companies - AGC']);
  });

  it('finds every project sharing a code, because a code is not unique', () => {
    /* CLI is the client prefix, not an id. Somebody typing it wants the client
       work, and getting all of it is the correct answer. */
    expect(find('cli')).toEqual(['Chitral Royal Homes', 'Attari Group of Companies - AGC']);
  });

  it('returns nothing for a query nothing matches, rather than everything', () => {
    expect(find('zzz')).toEqual([]);
  });

  it('⚠️ an empty query shows everything, not nothing', () => {
    /* The other way round blanks the page the instant somebody clears the box,
       which reads as the list having been destroyed. */
    expect(find('')).toHaveLength(3);
    expect(find('   ')).toHaveLength(3);
  });

  it('survives a project with no client and no owner', () => {
    /* Nulls join into the haystack as nothing rather than as "null" — a search
       for "null" must not return every unowned project. */
    expect(find('internal')).toEqual(['Internal CRM']);
    expect(find('null')).toEqual([]);
  });
});

describe('searchTerms', () => {
  it('splits on any run of whitespace and drops the empties', () => {
    expect(searchTerms('  royal \t homes \n ')).toEqual(['royal', 'homes']);
  });

  it('is empty for an empty query, which matchesSearch treats as "everything"', () => {
    expect(searchTerms('   ')).toEqual([]);
    expect(matchesSearch(CHITRAL, searchTerms('   '))).toBe(true);
  });
});
