**No hardcoded text.** Use `t('English text')`.

```tsx
✓ <Button>{t('Save')}</Button>
✗ <Button>Save</Button>
```
No need to write translation files because the translation is automated.

Run `npm run i18n` before commit by user.

**rules.**
- Any changes require human confirmation and consent.
- File encoding must be UTF-8 for all source files (.ts, .tsx, .json, .md, etc.). No BOM.