import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccess,homePath,isStaff,kitchenRoles,MIN_STAFF_PASSWORD,staffRoles } from '../src/lib/roles';

test('each role lands in its own workspace', () => {
  assert.equal(homePath('owner'), '/owner');
  assert.equal(homePath('manager'), '/owner');
  assert.equal(homePath('rider'), '/rider');
  assert.equal(homePath('customer'), '/');
  assert.equal(homePath(null), '/');
});
test('customers are never treated as staff', () => {
  assert.equal(isStaff('customer'), false);
  assert.equal(isStaff(undefined), false);
  for (const role of staffRoles) assert.equal(isStaff(role), true);
});
test('kitchen area is for owners and managers only', () => {
  assert.equal(canAccess('owner', kitchenRoles), true);
  assert.equal(canAccess('manager', kitchenRoles), true);
  assert.equal(canAccess('rider', kitchenRoles), false);
  assert.equal(canAccess('customer', kitchenRoles), false);
  assert.equal(canAccess(null, kitchenRoles), false);
});
test('owner-only areas exclude managers and riders', () => {
  assert.equal(canAccess('owner', ['owner']), true);
  assert.equal(canAccess('manager', ['owner']), false);
  assert.equal(canAccess('rider', ['owner']), false);
});
test('staff must choose a long password', () => assert.ok(MIN_STAFF_PASSWORD >= 10));
