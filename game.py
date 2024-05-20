import json
import sys

from pydantic import BaseModel


class GameState(BaseModel):
    board: 'Board'

class Board(BaseModel):
    grid: list[list]
    # TODO graph

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
        ('b', 2,2,2),
        ('b', 1,1,1,1,1),
        ('b', 2,1,1),
        ('b', 3),
    ]

    return board


def territory(board, row, col) -> tuple:
    return board.grid[row][col]


def move_piece(board: Board, army: str, piece: int, loc_i: tuple, loc_f: tuple) -> Board:

    row_i, col_i = loc_i
    territory_start = territory(board, row_i, col_i)
    assert territory_start[0] == army

    row_f, col_f = loc_f
    territory_end = territory(board, row_f, col_f)
    #assert territory_end == None # TODO or occupied by us or enemy

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
    else: # attack, TODO implement
        raise Exception('Attacking not implemented')

    board.grid[row_f][col_f] = t_f

    return board


def main():

    board = Board(grid=empty_grid(5,5))
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