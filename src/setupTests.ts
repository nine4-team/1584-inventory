import 'fake-indexeddb/auto'
import { expect } from 'vitest'
import '@testing-library/jest-dom'
import * as matchers from '@testing-library/jest-dom/matchers'

// Register jest-dom matchers with Vitest's expect
expect.extend(matchers)


