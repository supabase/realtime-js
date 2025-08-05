import assert from 'assert'
import { describe, beforeEach, afterEach, test, vi, expect } from 'vitest'
import RealtimeChannel from '../src/RealtimeChannel'
import {
  setupRealtimeTest,
  cleanupRealtimeTest,
  TestSetup,
} from './helpers/setup'

const defaultTimeout = 1000

let channel: RealtimeChannel
let testSetup: TestSetup

beforeEach(() => {
  testSetup = setupRealtimeTest({
    useFakeTimers: true,
    timeout: defaultTimeout,
  })
  channel = testSetup.socket.channel('test-postgres-validation')
})

afterEach(() => {
  cleanupRealtimeTest(testSetup)
  vi.restoreAllMocks()
  channel.unsubscribe()
})

describe('_validatePostgresChanges', () => {
  test.each([
    {
      description: 'should return empty array when no client bindings exist',
      bindings: undefined,
    },
    {
      description: 'should return empty array when client bindings is empty',
      bindings: [],
    },
  ])('$description', ({ bindings }) => {
    channel.bindings.postgres_changes = bindings

    // @ts-ignore - testing private method
    const result = channel._validatePostgresChanges([])

    assert.deepEqual(result, [])
  })

  test('should validate and enrich bindings with server IDs', () => {
    const clientBindings = [
      {
        type: 'postgres_changes',
        filter: {
          event: 'INSERT',
          schema: 'public',
          table: 'users',
          filter: 'id=eq.1',
        },
        callback: () => {},
      },
      {
        type: 'postgres_changes',
        filter: { event: 'UPDATE', schema: 'public', table: 'posts' },
        callback: () => {},
      },
    ]

    const serverChanges = [
      {
        event: 'INSERT',
        schema: 'public',
        table: 'users',
        filter: 'id=eq.1',
        id: 'server-id-1',
      },
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'posts',
        filter: undefined,
        id: 'server-id-2',
      },
    ]

    channel.bindings.postgres_changes = clientBindings

    // @ts-ignore - testing private method
    const result = channel._validatePostgresChanges(serverChanges)

    assert.equal(result.length, 2)
    assert.equal(result[0].id, 'server-id-1')
    assert.equal(result[1].id, 'server-id-2')
    assert.deepEqual(result[0].filter, clientBindings[0].filter)
    assert.deepEqual(result[1].filter, clientBindings[1].filter)
  })

  test('should throw error when bindings mismatch', () => {
    const clientBindings = [
      {
        type: 'postgres_changes',
        filter: { event: 'INSERT', schema: 'public', table: 'users' },
        callback: () => {},
      },
    ]

    const serverChanges = [
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        id: 'server-id-1',
      }, // Different event
    ]

    channel.bindings.postgres_changes = clientBindings

    // @ts-ignore - testing private method
    assert.throws(() => {
      channel._validatePostgresChanges(serverChanges)
    })
  })
})

describe('_isMatchingPostgresBinding', () => {
  test.each([
    {
      description: 'should return false when server change is null',
      clientBinding: {
        filter: {
          event: 'INSERT',
          schema: 'public',
          table: 'users',
          filter: undefined,
        },
      },
      serverChange: null,
      expected: false,
    },
    {
      description: 'should return false when server change is undefined',
      clientBinding: {
        filter: {
          event: 'INSERT',
          schema: 'public',
          table: 'users',
          filter: undefined,
        },
      },
      serverChange: undefined,
      expected: false,
    },
    {
      description: 'should return true when all properties match',
      clientBinding: {
        filter: {
          event: 'INSERT',
          schema: 'public',
          table: 'users',
          filter: 'id=eq.1',
        },
      },
      serverChange: {
        event: 'INSERT',
        schema: 'public',
        table: 'users',
        filter: 'id=eq.1',
        id: 'server-id',
      },
      expected: true,
    },
    {
      description: 'should return true when filter is undefined in both',
      clientBinding: {
        filter: {
          event: 'INSERT',
          schema: 'public',
          table: 'users',
          filter: undefined,
        },
      },
      serverChange: {
        event: 'INSERT',
        schema: 'public',
        table: 'users',
        filter: undefined,
        id: 'server-id',
      },
      expected: true,
    },
  ])('$description', ({ clientBinding, serverChange, expected }) => {
    // @ts-ignore - testing private method
    assert.equal(
      channel._isMatchingPostgresBinding(clientBinding, serverChange),
      expected
    )
  })

  test.each([
    {
      description: 'should return false when event differs',
      clientBinding: {
        filter: {
          event: 'INSERT',
          schema: 'public',
          table: 'users',
          filter: undefined,
        },
      },
      serverChange: {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: undefined,
        id: 'server-id',
      },
    },
    {
      description: 'should return false when schema differs',
      clientBinding: {
        filter: {
          event: 'INSERT',
          schema: 'public',
          table: 'users',
          filter: undefined,
        },
      },
      serverChange: {
        event: 'INSERT',
        schema: 'private',
        table: 'users',
        filter: undefined,
        id: 'server-id',
      },
    },
    {
      description: 'should return false when table differs',
      clientBinding: {
        filter: {
          event: 'INSERT',
          schema: 'public',
          table: 'users',
          filter: undefined,
        },
      },
      serverChange: {
        event: 'INSERT',
        schema: 'public',
        table: 'posts',
        filter: undefined,
        id: 'server-id',
      },
    },
    {
      description: 'should return false when filter differs',
      clientBinding: {
        filter: {
          event: 'INSERT',
          schema: 'public',
          table: 'users',
          filter: 'id=eq.1',
        },
      },
      serverChange: {
        event: 'INSERT',
        schema: 'public',
        table: 'users',
        filter: 'id=eq.2',
        id: 'server-id',
      },
    },
  ])('$description', ({ clientBinding, serverChange }) => {
    // @ts-ignore - testing private method
    assert.equal(
      channel._isMatchingPostgresBinding(clientBinding, serverChange),
      false
    )
  })
})

describe('_handleSubscriptionError', () => {
  let unsubscribeSpy: any
  let testError: Error

  beforeEach(() => {
    unsubscribeSpy = vi.spyOn(channel, 'unsubscribe')
    testError = new Error('test subscription error')
  })

  test('should unsubscribe, set error state, and call callback', () => {
    const callbackSpy = vi.fn()

    // @ts-ignore - testing private method
    channel._handleSubscriptionError(callbackSpy, testError)

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1)
    assert.equal(channel.state, 'errored')
    expect(callbackSpy).toHaveBeenCalledWith('CHANNEL_ERROR', testError)
  })

  test('should handle undefined callback gracefully', () => {
    // @ts-ignore - testing private method
    assert.doesNotThrow(() => {
      channel._handleSubscriptionError(undefined, testError)
    })

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1)
    assert.equal(channel.state, 'errored')
  })
})

describe('Postgres Changes Trigger Tests', () => {
  beforeEach(() => {
    channel = testSetup.socket.channel('test-postgres-trigger')
  })

  afterEach(() => {
    channel.unsubscribe()
  })

  test('triggers when type is postgres_changes', () => {
    const spy = vi.fn()

    channel.bindings.postgres_changes = [
      {
        id: 'abc123',
        type: 'postgres_changes',
        filter: { event: 'INSERT', schema: 'public', table: 'test' },
        callback: spy,
      },
    ]

    channel._trigger(
      'postgres_changes',
      {
        ids: ['abc123'],
        data: {
          type: 'INSERT',
          table: 'test',
          record: { id: 1 },
          schema: 'public',
          columns: [{ name: 'id', type: 'int4' }],
          commit_timestamp: '2000-01-01T00:01:01Z',
          errors: [],
        },
      },
      '1'
    )

    expect(spy).toHaveBeenCalledWith(
      {
        schema: 'public',
        table: 'test',
        commit_timestamp: '2000-01-01T00:01:01Z',
        eventType: 'INSERT',
        new: { id: 1 },
        old: {},
        errors: [],
      },
      '1'
    )
  })

  test('triggers when type is insert, update, delete', () => {
    const spy = vi.fn()

    channel.bindings.postgres_changes = [
      {
        type: 'postgres_changes',
        filter: { event: 'INSERT' },
        callback: spy,
      },
      {
        type: 'postgres_changes',
        filter: { event: 'UPDATE' },
        callback: spy,
      },
      {
        type: 'postgres_changes',
        filter: { event: 'DELETE' },
        callback: spy,
      },
      { type: 'postgres_changes', filter: { event: '*' }, callback: spy },
    ]

    channel._trigger('insert', { test: '123' }, '1')
    channel._trigger('update', { test: '123' }, '2')
    channel._trigger('delete', { test: '123' }, '3')

    expect(spy).toHaveBeenCalledTimes(6)
  })

  test('should match postgres_changes with ID binding', () => {
    const bind = {
      id: 'abc123',
      type: 'postgres_changes',
      filter: { event: 'INSERT' },
      callback: () => {},
    }
    const payload = {
      ids: ['abc123'],
      data: { type: 'INSERT' },
    }

    // @ts-ignore - testing private method
    assert.equal(
      channel._shouldTriggerBinding(bind, 'postgres_changes', payload),
      true
    )
  })

  test('should not match postgres_changes with wrong ID', () => {
    const bind = {
      id: 'abc123',
      type: 'postgres_changes',
      filter: { event: 'INSERT' },
      callback: () => {},
    }
    const payload = {
      ids: ['different-id'],
      data: { type: 'INSERT' },
    }

    // @ts-ignore - testing private method
    assert.equal(
      channel._shouldTriggerBinding(bind, 'postgres_changes', payload),
      false
    )
  })
})

describe('_prepareFinalPayload for postgres_changes', () => {
  test('should transform postgres_changes payload', () => {
    const handledPayload = {
      ids: ['abc123'],
      data: {
        type: 'INSERT',
        schema: 'public',
        table: 'users',
        commit_timestamp: '2023-01-01T00:00:00Z',
        errors: [],
        columns: [{ name: 'id', type: 'int4' }],
        record: { id: 1, name: 'test' },
      },
    }

    const getPayloadRecordsSpy = vi
      .spyOn(channel, '_getPayloadRecords')
      .mockReturnValue({
        new: { id: 1, name: 'test' },
        old: {},
      })

    // @ts-ignore - testing private method
    const result = channel._prepareFinalPayload({}, handledPayload)

    assert.equal(result.schema, 'public')
    assert.equal(result.table, 'users')
    assert.equal(result.eventType, 'INSERT')
    assert.equal(result.commit_timestamp, '2023-01-01T00:00:00Z')
    assert.deepEqual(result.new, { id: 1, name: 'test' })
    assert.deepEqual(result.old, {})
    assert.deepEqual(result.errors, [])

    expect(getPayloadRecordsSpy).toHaveBeenCalledWith(handledPayload.data)
  })

  test('should return payload as-is for non-postgres events', () => {
    const handledPayload = { event: 'test', data: 'simple' }

    // @ts-ignore - testing private method
    const result = channel._prepareFinalPayload({}, handledPayload)

    assert.deepEqual(result, handledPayload)
  })
})
