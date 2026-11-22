import {simulation} from './playoff-simulation.mjs';

self.onmessage = ({data}) => {
  try {
    const result = simulation(data.input,data.choices).runTo(data.count,
      completed => self.postMessage({completed}));
    self.postMessage({result});
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
