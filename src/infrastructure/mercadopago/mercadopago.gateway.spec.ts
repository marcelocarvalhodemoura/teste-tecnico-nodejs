import { toGatewayOutcome } from './mercadopago.gateway';

describe('toGatewayOutcome', () => {
  it.each([
    ['approved', 'APPROVED'],
    ['rejected', 'REJECTED'],
    ['cancelled', 'REJECTED'],
    ['refunded', 'REJECTED'],
    ['charged_back', 'REJECTED'],
    ['pending', 'IN_PROGRESS'],
    ['in_process', 'IN_PROGRESS'],
    ['authorized', 'IN_PROGRESS'],
    ['in_mediation', 'IN_PROGRESS'],
    [undefined, 'IN_PROGRESS'],
  ])('status %s → %s', (status, expected) => {
    expect(toGatewayOutcome(status)).toBe(expected);
  });
});
