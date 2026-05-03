- consider typescript task
- For instance a lot of bloat from defining additional types with TypeScript
- create a typescript environment
- create an agent (openai) that will fix an issue with the typescript environment

Agent
- Pydantic AI SDK
- code environment containerized, agent sdk makes changes to the containerized code environment to fix issues


Code environment
- Contains testcases, some visible some hidden to the agent
- Dockerized
- Git version control to organize state within the doctorized container of the test repository