import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div>
      <h1>My First React App</h1>
      <p>こんにちは！</p>

      <h2>{count}</h2>

      <button onClick={() => setCount(count + 1)}>
        ＋1
      </button>

      <button onClick={() => setCount(0)}>
        リセット
      </button>
    </div>
  )
}

export default App