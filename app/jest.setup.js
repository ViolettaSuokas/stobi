// Jest setup — mocks for native modules that don't run outside RN runtime.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Avoid running Supabase client in unit tests — it pulls in network stack.
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: null } })),
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(async () => ({ data: null, error: null })),
    })),
    rpc: jest.fn(async () => ({ data: null, error: null })),
  })),
}));
