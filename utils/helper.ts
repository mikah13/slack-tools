function getRandomIndex(array: string[], lastIndex: number): number {
  let newIndex: number;
  do {
    newIndex = Math.floor(Math.random() * array.length);
  } while (newIndex === lastIndex && array.length > 1);
  lastIndex = newIndex;
  return newIndex;
}

export { getRandomIndex };
