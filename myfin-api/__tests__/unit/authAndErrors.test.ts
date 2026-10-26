import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import joi from 'joi';
import { mockedPrisma } from './prisma.mock.js';
import CommonsController from '../../src/controllers/commonsController.js';
import SessionManager from '../../src/utils/sessionManager.js';
import UserService from '../../src/services/userService.js';
import { apiErrorHandler } from '../../src/middlewares/apiErrorHandler.js';

const requestWithHeaders = (headers: Record<string, string>) =>
  ({ get: (name: string) => headers[name] }) as never;

describe('checkAuthSessionValidity', () => {
  const originalBypass = process.env.BYPASS_SESSION_CHECK;

  beforeEach(() => {
    vi.spyOn(UserService, 'getUserCount').mockResolvedValue(1);
    vi.spyOn(UserService, 'getUserIdFromUsername').mockResolvedValue(7n);
  });

  afterEach(() => {
    process.env.BYPASS_SESSION_CHECK = originalBypass;
    vi.restoreAllMocks();
  });

  test('with BYPASS_SESSION_CHECK=true the session key is not checked', async () => {
    process.env.BYPASS_SESSION_CHECK = 'true';
    const sessionCheck = vi.spyOn(SessionManager, 'checkIfSessionKeyIsValid').mockResolvedValue(false);

    const session = await CommonsController.checkAuthSessionValidity(
      requestWithHeaders({ authusername: 'demo', sessionkey: 'anything' })
    );

    expect(session.userId).toBe(7n);
    expect(sessionCheck).not.toHaveBeenCalled();
  });

  test('without bypass a valid session key is accepted', async () => {
    process.env.BYPASS_SESSION_CHECK = 'false';
    vi.spyOn(SessionManager, 'checkIfSessionKeyIsValid').mockResolvedValue(true);

    const session = await CommonsController.checkAuthSessionValidity(
      requestWithHeaders({ authusername: 'demo', sessionkey: 'good' })
    );

    expect(session.userId).toBe(7n);
  });

  test('without bypass an invalid session key is rejected with 401', async () => {
    process.env.BYPASS_SESSION_CHECK = 'false';
    vi.spyOn(SessionManager, 'checkIfSessionKeyIsValid').mockResolvedValue(false);

    await expect(
      CommonsController.checkAuthSessionValidity(requestWithHeaders({ authusername: 'demo', sessionkey: 'bad' }))
    ).rejects.toMatchObject({ code: 401 });
  });

});

describe('getUserIdFromUsername', () => {
  test('an unknown username is rejected with 401', async () => {
    mockedPrisma.users.findUnique.mockResolvedValue(null);

    await expect(UserService.getUserIdFromUsername('ghost', mockedPrisma)).rejects.toMatchObject({ code: 401 });
  });

  test('a missing username is rejected with 401 without querying', async () => {
    await expect(UserService.getUserIdFromUsername(undefined as never, mockedPrisma)).rejects.toMatchObject({
      code: 401,
    });
    expect(mockedPrisma.users.findUnique).not.toHaveBeenCalled();
  });

  test('a known username returns its id', async () => {
    mockedPrisma.users.findUnique.mockResolvedValue({ user_id: 7n } as never);

    await expect(UserService.getUserIdFromUsername('demo', mockedPrisma)).resolves.toBe(7n);
  });
});

describe('createUser', () => {
  test('a taken username or email is rejected with 409', async () => {
    mockedPrisma.users.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    );

    await expect(
      UserService.createUser({ username: 'demo', password: '123', email: 'demo@afaneca.com' }, mockedPrisma)
    ).rejects.toMatchObject({ code: 409 });
  });
});

describe('apiErrorHandler', () => {
  const responseSpy = () => {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
  };

  test('a joi validation error becomes a 400 with its message', async () => {
    const validationError = await joi
      .object({ sort_by: joi.string().valid('date') })
      .validateAsync({ sort_by: 'bogus' })
      .catch((err) => err);
    const res = responseSpy();

    apiErrorHandler(validationError, {} as never, res as never, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: '"sort_by" must be [date]' });
  });

  test('other unexpected errors stay 500', () => {
    const res = responseSpy();

    apiErrorHandler(new Error('boom') as never, {} as never, res as never, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
