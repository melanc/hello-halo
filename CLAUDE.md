**No hardcoded text.** Use `t('English text')`.

```tsx
✓ <Button>{t('Save')}</Button>
✗ <Button>Save</Button>
```
No need to write translation files because the translation is automated.

Run `npm run i18n` before commit by user.

**rules.**
- DO NOT use the Task tool or launch sub-agents unless the user explicitly requests it.
