import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Todo } from './Todo';
import './styles.css';

const initialTodos = [
  { id: 1, text: 'Learn mobx-mantle', done: false },
  { id: 2, text: 'Build something great', done: false },
];

function App() {
  return (
    <div className="app">
      <h1>mobx-mantle playground</h1>
      <Todo 
        title="My Tasks" 
        initialTodos={initialTodos}
        onCountChange={(count) => console.log(`Completed: ${count}`)}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
