import { blockKeysWhileReadOnly, blockWhileReadOnly, readOnlyControl } from './read-only-control';

describe('readOnlyControl', () => {
  it('keeps a permission read-only control focusable and announces it', () => {
    expect(readOnlyControl({ readOnly: true, noteId: 'note-1' })).toEqual({
      disabled: false,
      'aria-disabled': true,
      'aria-describedby': 'note-1',
      blocked: true,
    });
  });

  it('leaves an explicitly disabled control disabled', () => {
    expect(readOnlyControl({ readOnly: true, disabled: true, noteId: 'note-1' })).toEqual({
      disabled: true,
      blocked: false,
    });
  });

  it('changes nothing outside a permission read-only context', () => {
    expect(readOnlyControl({ readOnly: false })).toEqual({ disabled: false, blocked: false });
    expect(readOnlyControl({ readOnly: false, disabled: true })).toEqual({ disabled: true, blocked: false });
  });
});

describe('blockWhileReadOnly', () => {
  it('blocks the change while read-only', () => {
    const own = jest.fn();
    const event = { preventDefault: jest.fn() };
    blockWhileReadOnly(true, own)(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(own).not.toHaveBeenCalled();
  });

  it('passes the event through otherwise', () => {
    const own = jest.fn();
    const event = { preventDefault: jest.fn() };
    blockWhileReadOnly(false, own)(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(own).toHaveBeenCalledWith(event);
  });
});

describe('blockKeysWhileReadOnly', () => {
  const key = (k: string) => ({ key: k, preventDefault: jest.fn() });

  it('stops typing and opening keys while read-only', () => {
    const own = jest.fn();
    for (const k of ['a', 'ArrowDown', 'Enter', ' ']) {
      const event = key(k);
      blockKeysWhileReadOnly(true, own)(event);
      expect(event.preventDefault).toHaveBeenCalled();
    }
    expect(own).not.toHaveBeenCalled();
  });

  it('lets focus move away with Tab', () => {
    const event = key('Tab');
    blockKeysWhileReadOnly(true)(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('passes every key through otherwise', () => {
    const own = jest.fn();
    const event = key('a');
    blockKeysWhileReadOnly(false, own)(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(own).toHaveBeenCalledWith(event);
  });
});
