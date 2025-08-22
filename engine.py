# Rock War v1 Game Engine

import json


fib = [1,1,2,3,5,8,13,21]

game_map_8_2 = {
    'obelisks': 'xy',
    'territories': 'abcdefgh',
    'edges': ['ab', 'ad', 'bc', 'bd', 'be', 'ce', 'cf', 'de', 'dg', 'eg', 'ef', 'fg', 'fh', 'gh', 'xa', 'xb', 'xd', 'yf', 'yg', 'yh'],
    # army_size: 3 ?
}

game = {
    'map': game_map_8_2,
    'obelisks': ['fire', 'earth'],
    'armies': ['smooth', 'rocky'],
    'army_size': 3,
}

def print_rocks(army, rocks):

    s = ''

    if army == 'SMOOTH':
        for v in rocks:
            if v == 1:
                s += 'o'
            else:
                s += f'({v})'

    if army == 'ROCKY':
        for v in rocks:
            if v == 1:
                s += '[]'
            else:
                s += f'[{v}]'

    return s


def print_terr(army, rocks):

    s = print_rocks(army, rocks)

    if len(s) < 6:
        s += ' '*(6-len(s))

    assert len(s) == 6
    return s

def print_game(state):

    board = state['board']
    aaaa = print_terr(**board['a'])
    bbbb = print_terr(**board['b'])
    cccc = print_terr(**board['c'])
    dddd = print_terr(**board['d'])
    eeee = print_terr(**board['e'])
    ffff = print_terr(**board['f'])
    gggg = print_terr(**board['g'])
    hhhh = print_terr(**board['h'])

    reserves = state['reserves']
    reserves_s = print_rocks('SMOOTH', reserves['SMOOTH'])
    reserves_r = print_rocks('ROCKY', reserves['ROCKY'])

    graveyard = state['graveyard']
    graveyard_s = print_rocks('SMOOTH', graveyard['SMOOTH'])
    graveyard_r = print_rocks('ROCKY', graveyard['ROCKY'])



    print()
    print(f'|---------------------------------------------')
    print(f'|          |    {bbbb}    |     {cccc}       |')
    print(f'| {aaaa}   |     _________|__                |')
    print(f'|          |    /           /----------------|')
    print(f'|---------/X\--|  {eeee}   /    {ffff}      / ')
    print(f' \             |__________/                /  ')
    print(f'  \  {dddd}    |          \------\Y/------/_  ')
    print(f'   \           |                 |          \ ')
    print(f'    ------------\  {gggg}        | {hhhh}    |')
    print(f'                 \_______________|___________|')
    print()
    print(f'{reserves_s: <20}      {graveyard_s}  ')
    print(f'{reserves_r: <20}      {graveyard_r}  ')
    print()


def initial_state(game):
    return {
        'reserves': {
            'SMOOTH': [1,1,1,2,2,3], # gen_army(3)
            'ROCKY': [1,1,1,2,2,3],
        },
        'board': {x: {'army': None, 'rocks': []} for x in game_map_8_2['territories']},
        'map': game['map'],
        'graveyard': {
            'SMOOTH': [],
            'ROCKY': [],
        },
    }

def state_is_valid(state):
    return True


def spawn(state, army, t, v=1, spawn_open=False):

    if not spawn_open:
        assert state['board'][t]['army'] == army
        assert state['board'][t]['rocks'] == [v+1] or [v] # TODO fibonacci up and down

    state['reserves'][army].remove(v)
    state['board'][t]['rocks'].append(v)
    state['board'][t]['army'] = army

    assert state_is_valid(state)
    print(json.dumps(state_lite(state)))
    return state


def claimed_by(board, t):
    return board[t]['army']


def is_open(board, t):
    return claimed_by(board, t) == None

def are_adjacent(game_map, ti, tf):
    x = ''.join(sorted([ti, tf]))
    return x in game_map['edges']

def move(state, army, ti, tf, v=1):

    board = state['board']

    assert is_open(board, tf)
    assert claimed_by(board, ti) == army
    assert are_adjacent(state['map'], ti, tf)

    board[ti]['rocks'].remove(v)

    if board[ti]['rocks'] == []:
        board[ti]['army'] = None

    board[tf]['rocks'].append(v)
    board[tf]['army'] = army

    assert state_is_valid(state)
    print(json.dumps(state_lite(state)))
    return state


def evolvable(a, b):
    return a == b == 1 or abs(a-b) == 1 # TODO fibonacci


def evolve(state, army, t):
    terr = state['board'][t]

    assert terr['army'] == army
    assert len(terr['rocks']) == 2

    a,b = terr['rocks']
    assert evolvable(a,b)

    state['reserves'][army].remove(a+b)    # :)
    state['reserves'][army].extend([a,b])
    state['board'][t]['rocks'] = [a+b]

    assert state_is_valid(state)
    print(json.dumps(state_lite(state)))
    return state


def state_lite(state):
    return {t: d for t, d in state['board'].items() if d['army']}

def opponent(state, army):
    armies = state['reserves'].keys() # hack, should pass in game?
    return next(a for a in armies if a != army)

def attack(state, army, ti, tf, v):

    terr_i = state['board'][ti]
    terr_f = state['board'][tf]

    assert terr_i['army'] != terr_f['army'] != None
    assert v in terr_i['rocks']

    attacker = v
    defenders = list(reversed(sorted(terr_f['rocks'])))
    defender = defenders[0]

    if attacker - defender > 1:
        # simple combat, roll through

        terr_i['rocks'].remove(attacker)
        if terr_i['rocks'] == []:
            terr_i['army'] = None

        terr_f['rocks'].remove(defender)
        terr_f['army'] = army
        terr_f['rocks'].append(attacker)

        state['graveyard'][opponent(state, army)].append(defender)


    assert state_is_valid(state)
    print(json.dumps(state_lite(state)))
    return state


def play(game):

    # Input
    print(json.dumps(game))

    # Initialize
    state = initial_state(game)
    print(json.dumps(state))

    # Placement
    state = spawn(state, 'SMOOTH', 'd', spawn_open=True)
    state = spawn(state, 'ROCKY', 'f', spawn_open=True)
    print_game(state)

    # Turn 1
    state = spawn(state, 'SMOOTH', 'd')
    state = move(state, 'SMOOTH', 'd', 'g', v=1)
    print_game(state)

    # Turn 2
    state = spawn(state, 'ROCKY', 'f')
    state = evolve(state, 'ROCKY', 'f') # borders earth, scouts evolve free
    print_game(state)

    # Turn 3
    # max rock = o (1) --> evolve / spawn = 1
    state = spawn(state, 'SMOOTH', 'g')
    # n terr = 2 --> move / attack = 2
    state = move(state, 'SMOOTH', 'g', 'h')
    state = move(state, 'SMOOTH', 'd', 'e')
    print_game(state)

    # Turn 4
    state = spawn(state, 'ROCKY', 'f')
    state = evolve(state, 'ROCKY', 'f')
    state = attack(state, 'ROCKY', 'f', 'g', 3)
    print_game(state)

    # Turn 5
    # r - evolve / attack   = 1
    # t - spawn / move      = 2


def main():
    play(game)


main()
