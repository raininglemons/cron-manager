// @flow

const toSimpleObject = (object: any) => {
  if (typeof object !== 'object') {
    return object;
  }

  if (object instanceof Array) {
    const simpleArray = [].concat(object);

    simpleArray.map(toSimpleObject);
  }

  const simpleObject = Object.assign({}, object);

  Object.keys(simpleObject).forEach(key => {
    simpleObject[key] = toSimpleObject(simpleObject[key]);
  });

  return simpleObject;
};

export default toSimpleObject;
