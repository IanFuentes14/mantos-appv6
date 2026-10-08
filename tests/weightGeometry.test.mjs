import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWeightGeometry as calculate, convertDimension, LIFTING_MATERIALS } from '../src/lib/weightGeometry.js';

function near(actual, expected) { assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * 1e-10, `${actual} != ${expected}`); }

test('all six solid geometries calculate volume and steel weight', () => {
  const cases = [
    ['cuboid', { length: 2, width: 3, height: 4 }, 24],
    ['cube', { side: 2 }, 8],
    ['cylinder', { diameter: 2, height: 3 }, 3 * Math.PI],
    ['sphere', { diameter: 2 }, 4 / 3 * Math.PI],
    ['cone', { diameter: 2, height: 3 }, Math.PI],
    ['pyramid', { length: 2, width: 3, height: 4 }, 8],
  ];
  for (const [shape, dimensions, volume] of cases) {
    const result = calculate(shape, dimensions, 'm', 7850);
    assert.equal(result.status, 'ready');
    near(result.volume, volume);
    near(result.weight, volume * 7850);
  }
});

test('centimeters, meters and inches describe the same cube', () => {
  for (const [unit, side] of [['m', 0.254], ['cm', 25.4], ['in', 10]]) {
    near(calculate('cube', { side }, unit, 1400).weight, 0.254 ** 3 * 1400);
  }
  assert.equal(convertDimension('100', 'cm', 'm'), '1');
  assert.equal(convertDimension('1', 'in', 'cm'), '2.54');
  assert.equal(convertDimension('', 'cm', 'm'), '');
  near(Number(convertDimension(convertDimension('37.8', 'cm', 'in'), 'in', 'cm')), 37.8);
});

test('hollow tube subtracts its internal volume and rejects impossible thickness', () => {
  const result = calculate('cylinder', { diameter: 100, height: 200, thickness: 10 }, 'cm', 7850, true);
  near(result.volume, Math.PI * 2 * (0.5 ** 2 - 0.4 ** 2));
  for (const thickness of [50, 60]) {
    const invalid = calculate('cylinder', { diameter: 100, height: 200, thickness }, 'cm', 7850, true);
    assert.equal(invalid.status, 'invalid');
    assert.ok(invalid.errors.thickness);
  }
});

test('incomplete or invalid values never produce a misleading weight', () => {
  assert.equal(calculate('cuboid', { length: 2 }, 'm', 950).status, 'incomplete');
  for (const side of ['0', '-1', 'text', 'Infinity', '1e200', '1e-200']) {
    const result = calculate('cube', { side }, 'm', 950);
    assert.equal(result.status, 'invalid');
    assert.equal(result.weight, undefined);
  }
  near(calculate('cube', { side: '1,5' }, 'm', 950).volume, 3.375);
});

test('existing material densities remain unchanged and drive each result', () => {
  assert.deepEqual(LIFTING_MATERIALS.map((material) => material.density), [1400, 950, 2400, 8960, 7850, 8000, 7860, 11340]);
  for (const material of LIFTING_MATERIALS) near(calculate('cube', { side: 1 }, 'm', material.density).weight, material.density);
});
