import { actorName, commentAgentName, hasOwner, taskAgent } from '../../../frontend/src/lib/taskAgent';

describe('taskAgent', () => {
  it('reads the agent from the labels Autopilot writes', () => {
    expect(taskAgent({ labels: ['autopilot', 'ai-agent', 'agent:analyst'] })).toEqual({ role: 'analyst', name: 'Analyst agent', withPerson: false });
    expect(taskAgent({ labels: ['autopilot', 'agent-plus-person', 'agent:writer'] })?.withPerson).toBe(true);
  });

  it('returns null for work people do', () => {
    expect(taskAgent({ labels: ['autopilot', 'person'] })).toBeNull();
    expect(taskAgent({})).toBeNull();
  });
});

describe('hasOwner', () => {
  it('counts an agent as the owner of an unassigned task', () => {
    expect(hasOwner({ assigned_to: null, labels: ['ai-agent', 'agent:builder'] })).toBe(true);
    expect(hasOwner({ assigned_to: 'user-1' })).toBe(true);
    expect(hasOwner({ assigned_to: null, labels: ['person'] })).toBe(false);
  });
});

describe('actorName', () => {
  it('names agents, people and the engine roles', () => {
    expect(actorName('agent:writer')).toBe('Writer agent');
    expect(actorName('person:Yousef Al-Ghamdi')).toBe('Yousef Al-Ghamdi');
    expect(actorName('reviewer')).toBe('Reviewer agent');
    expect(actorName('scheduler')).toBe('Scheduler');
  });
});

describe('commentAgentName', () => {
  it('finds the agent in a deliverable comment and ignores other comments', () => {
    expect(commentAgentName('Autopilot · researcher agent delivered this (attempt 1, passed review).')).toBe('Researcher agent');
    expect(commentAgentName('Looks good to me')).toBeNull();
  });
});
