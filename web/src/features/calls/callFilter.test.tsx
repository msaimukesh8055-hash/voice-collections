// web/src/features/calls/callFilter.test.tsx
// The calls-page filter Agent health links to (2026-11-22): read from the address, written back
// into one, and applied to a list.
import { filteredCallsHref, onlyFiltered, readCallFilter } from './callFilter.tsx';

describe('call filter', () => {
  it('reads ids and a label from the address, or nothing for the plain list', () => {
    expect(readCallFilter('?ids=a,b&label=Need+a+look')).toEqual({
      ids: ['a', 'b'],
      label: 'Need a look',
    });
    expect(readCallFilter('?ids=a')).toEqual({ ids: ['a'], label: 'Selected calls' });
    expect(readCallFilter('')).toBeNull();
    expect(readCallFilter('?id=a')).toBeNull();
  });

  it('writes an address that reads back the same', () => {
    const filter = { ids: ['a', 'b'], label: 'Told them the owner will call back' };
    const href = filteredCallsHref('/munshi-calls', filter);
    expect(href.startsWith('/munshi-calls?')).toBe(true);
    expect(readCallFilter(href.slice(href.indexOf('?')))).toEqual(filter);
  });

  it('keeps only the chosen rows, or all of them with no filter', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(onlyFiltered(rows, { ids: ['c', 'a'], label: 'x' })).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(onlyFiltered(rows, null)).toBe(rows);
  });
});
