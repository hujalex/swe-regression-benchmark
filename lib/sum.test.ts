import { describe, expect, test } from "vitest";
import { sum } from "./sum.js";

test("add 1 + 2 to equal 3", () => {
  expect(sum(1, 2)).toBe(3);
});

test("Math sqrt works for perfect squares", () => {
  expect(Math.sqrt(4)).toBe(2);
  expect(Math.sqrt(144)).toBe(12);
  expect(Math.sqrt(0)).toBe(0);
});

describe("Math.sqrt", () => {
  test("returns the square root of perfect squares", () => {
    expect(Math.sqrt(4)).toBe(2);
    expect(Math.sqrt(9)).toBe(3);
  });

  test("returns NaN for negative numbers", () => {
    expect(Math.sqrt(-1)).toBeNaN();
  });

  test("returns 0 for 0", () => {
    expect(Math.sqrt(0)).toBe(0);
  });
});

interface User {
  name: string;
  age: number;
}

function createUser(name: string, age: number): User {
  return { name, age };
}

test("Creates a user with the correct fields", () => {
  const user = createUser("Alice", 20);

  expect(user).toEqual({ name: "Alice", age: 20 });
  expect(user.name).toBe("Alice");
  expect(user.age).toBe(20);
});

test.for([
  [1, 1, 2],
  [1, 2, 3],
  [2, 1, 3],
])("add(%i, %i) -> %i", ([a, b, expected]) => {
  expect(a + b).toBe(expected);
});

test.for([
  { a: 1, b: 1, expected: 2 },
  { a: 1, b: 2, expected: 3 },
  { a: 2, b: 1, expected: 3 },
])(`add($a, $b) -> $expected`, ({ a, b, expected }) => {
  expect(a + b).toBe(expected);
});

test("Test toMatchObject", () => {
  const user: any = { name: "Alice", age: 20, state: "New York" };

  expect(user).toMatchObject({ name: "Alice", age: 20 });
});

test.todo("user has the right shape", () => {
  const user = createUser("Alice", 20);
});

function compileString(input: string) {
  if (input === "") {
    throw new Error("Empty String");
  }
}

test("compiling empty string throws error", () => {
  expect(() => compileString("")).toThrow();
  expect(() => compileString("")).toThrow("Empty String");
});

async function resolve(id: number) {
  return Promise.resolve({ id: id, name: "Alice", age: 20 });
}

test("fetches user by id", async () => {
  const response = await resolve(1);
  expect(response).toEqual({ id: 1, name: "Alice", age: 20 });
  expect(response.id).toBe(1);
});
