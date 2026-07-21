# Testing

- Test runner: Jest with the `jest-expo` preset and `jest.setup.js` (check it for existing global mocks before writing your own).
- Tests live flat in `src/__tests__/<module>.test.js`, named after the module under test.
- New or changed code in `src/services/`, `src/utils/`, or `src/context/` needs tests. Pure helper functions get thorough edge-case coverage; side-effecting functions get mocked-dependency tests focused on arguments and error paths.
- Never hit real backends in tests: Firebase is mocked (see `src/__tests__/firestore.test.js`), external HTTP APIs are tested via their pure helpers or a mocked `fetch`.
- Component/context tests use `@testing-library/react-native` (see `ThemeContext.test.js`).
- Run `npm test` before committing; a single file runs with `npm test -- <file>`.
