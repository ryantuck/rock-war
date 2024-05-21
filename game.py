import json
import sys

from pydantic import BaseModel


class GameState(BaseModel):
    board: 'Board'

class Board(BaseModel):
    grid: list[list] # TODO graph
    captured: dict


def empty_grid(cols, rows):
    return [[None]*rows]*cols

def place_initial_pieces(board: Board) -> Board:
    board.grid[0] = [
        ('a', 3),
        ('a', 2,1,1),
        ('a', 1,1,1,1,1),
        ('a', 2,2),
        ('a', 3),
    ]

    board.grid[-1] = [
        ('b', 3),
        ('b', 2,2),
        ('b', 1,1,1,1,1),
        ('b', 2,1,1),
        ('b', 3),
    ]

    return board


def territory(board, row, col) -> tuple:
    return board.grid[row][col]

def attack(board: Board, army: str, loc_i: tuple, loc_f: tuple) -> Board:

    ri, ci = loc_i
    rf, cf = loc_f
    terr_i = board.grid[ri][ci]
    terr_f = board.grid[rf][cf]

    assert terr_i[0] == army
    assert terr_f[0] != army

    pcs_attack = terr_i[1:]
    pcs_defense = terr_f[1:]
    assert sum(pcs_attack) > sum(pcs_defense)

    board.captured[terr_f[0]] += pcs_defense
    board.grid[rf][cf] = tuple([army] + list(pcs_attack))
    board.grid[ri][ci] = None

    return board



def move_piece(board: Board, army: str, piece: int, loc_i: tuple, loc_f: tuple) -> Board:

    row_i, col_i = loc_i
    territory_start = territory(board, row_i, col_i)
    assert territory_start[0] == army

    row_f, col_f = loc_f
    territory_end = territory(board, row_f, col_f)
    assert territory_end is None or territory_end[0] == army

    # set new t_i
    t_i = list(territory_start)
    pc_idx = t_i.index(piece)
    t_i.pop(pc_idx)
    if set(t_i) == set([army]):
        board.grid[row_i][col_i] = None
    else:
        board.grid[row_i][col_i] = tuple(t_i)

    # set new t_f
    if territory_end is None: # free space
        t_f = (army, piece)
    elif territory_end[0] == army: # friendly
        t_f = tuple(list(territory_end) + [piece])
    else: # moving is only for free-space or friendly territory
        raise Exception('Use attack() fn')

    board.grid[row_f][col_f] = t_f

    # sort all territories
    for row_idx, row in enumerate(board.grid):
        for col_idx, terr in enumerate(row):
            if terr is None:
                continue
            a = terr[0]
            pcs = sorted(terr[1:], reverse=True)
            board.grid[row_idx][col_idx] = tuple([a] + pcs)

    return board


def main():

    board = Board(grid=empty_grid(5,5), captured={'a':[], 'b': []})
    print(json.dumps(board.dict()))

    board = place_initial_pieces(board)
    print(json.dumps(board.dict()))

    # turn 1 - a - cost=12, bring 3s out and one scout
    mvs = [
        ('a', 1, (0,1),(1,1)), # down
        ('a', 1, (1,1),(1,0)), # then left
        ('a', 3, (0,0),(1,0)), # then 3 out


        ('a', 1, (0,2),(1,2)), # down
        ('a', 1, (1,2),(1,3)), # then right
        ('a', 1, (1,3),(1,4)), # then right again
        ('a', 3, (0,4),(1,4)), # then 3 out
        
        ('a', 1, (0,2),(1,2)), # down
    ]

    for mv in mvs:
        board = move_piece(board, *mv)
        print(json.dumps(board.dict()))

    # turn 2 - b - aggressive center
    mvs_2 = [
        ('b', 1, (4,3),(3,3)), # up
        ('b', 2, (4,3),(3,3)), # up
        ('b', 1, (3,3),(2,3)), # up
        ('b', 2, (3,3),(2,3)), # up
        ('b', 1, (2,3),(2,2)), # left
        ('b', 2, (2,3),(2,2)), # left

        ('b', 1, (4,2),(3,2)), # up
        ('b', 1, (3,2),(2,2)), # up

        ('b', 1, (4,2),(3,2)), # up
    ]
    for mv in mvs_2:
        board = move_piece(board, *mv)
        print(json.dumps(board.dict()))

    # turn 3 - a - flank and consolidate
    mvs_3 = [
        ('a', 1, (1,2),(1,3)), # right
        ('a', 2, (0,3),(1,3)), # down
        ('a', 3, (1,4),(1,3)), # left

        ('a', 1, (0,1),(1,1)), # down
        ('a', 2, (0,1),(1,1)), # down
        ('a', 3, (1,0),(1,1)), # right
    ]

    for mv in mvs_3:
        board = move_piece(board, *mv)
        print(json.dumps(board.dict()))

    # turn 4 - b - raid the nest
    mvs_4 = [
        ('b', 1, (3,2),(3,1)), # left

        ('b', 1, (2,2),(1,2)), # up
        ('b', 1, (2,2),(1,2)), # up
        ('b', 2, (2,2),(1,2)), # up

        # TODO - attack (1,2) -> (0,2), cost=7
    ]

    for mv in mvs_4:
        board = move_piece(board, *mv)
        print(json.dumps(board.dict()))

    board = attack(board, 'b', (1,2), (0,2))
    print(json.dumps(board.dict()))

    # turn 5 - a - retaliate
    board = move_piece(board, 'a', 3, (1,3),(0,3))
    print(json.dumps(board.dict()))

    board = attack(board, 'a', (0,3), (0,2))
    print(json.dumps(board.dict()))

    # turn 6 - b - control middle
    mvs_6 = [

        # TODO ('b', pcs=[2,2], from=(4,1), dir='up')
        ('b', 2, (4,1), (3,1)), # up
        ('b', 2, (4,1), (3,1)), # up

        ('b', 1, (4,2), (3,2)), # up
        ('b', 2, (3,1), (3,2)), # right

        ('b', 1, (3,2), (2,2)), # up
        ('b', 2, (3,2), (2,2)), # up

        ('b', 1, (4,3), (3,3)), # up

        ('b', 1, (4,2), (4,3)), # right        
    ]

    for mv in mvs_6:
        board = move_piece(board, *mv)
        print(json.dumps(board.dict()))


if __name__ == '__main__':
    main()


# def choose_moves(board, army):
#     units = 12
#     for territory in territories(board, army):
#         for option in available_moves(board, army, territory):
#             if option.move_type == 'attack':
#                 board = attack(board, army, option.army, option.territory, option.target)
#                 units -= option.cost_units
#                 continue